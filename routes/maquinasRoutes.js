// routes/maquinasRoutes.js
const express = require('express');
const { ObjectId } = require('mongodb');
const { getCollection } = require('../services/db');
const { requireAuth, requireControl } = require('../middleware/requireAuth');
const { logChangeAndTrim, pickMachineFields } = require('../services/audit');

const router = express.Router();
const MACHINES = () => getCollection('machines');

// --------- utils ---------
const toStr = (v) => (v == null ? '' : String(v)).trim();
const nameKeyOf = (name) => toStr(name).toLowerCase();
const TYPES = new Set(['CSF-DOBLE','PEL-CSF','2023-CSF','2024-CSF']);

function parseStartDate(v) {
  const s = toStr(v);
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function sanitizePayload(body = {}) {
  const machineName = toStr(body.machineName);
  const company     = toStr(body.company);
  const provider    = toStr(body.provider);
  const type        = toStr(body.type);
  const initialCounter = Number(body.initialCounter ?? 0);
  const startDate   = parseStartDate(body.startDate);

  if (!machineName || machineName.length < 2) {
    const err = new Error('Nombre de máquina requerido');
    err.status = 400; throw err;
  }
  if (!Number.isFinite(initialCounter) || initialCounter < 0) {
    const err = new Error('Contador inicial inválido');
    err.status = 400; throw err;
  }
  if (type && !TYPES.has(type)) {
    const err = new Error('Tipo inválido (use CSF-DOBLE, PEL-CSF, 2023-CSF o 2024-CSF)');
    err.status = 400; throw err;
  }

  return {
    machineName,
    nameKey: nameKeyOf(machineName),
    company,
    provider,
    type: type || null,
    startDate,
    initialCounter,
  };
}

// Crear índice de unicidad por nombre (case-insensitive)
let _idxReady = false;
async function ensureIndexes() {
  if (_idxReady) return;
  try {
    await MACHINES().createIndex({ nameKey: 1 }, { unique: true, sparse: true });
  } catch (_) {}
  _idxReady = true;
}
ensureIndexes();

// --------- RUTAS ---------

// LISTAR (solo lectura)
router.get('/', requireAuth, async (_req, res) => {
  try {
    const list = await MACHINES()
      .find({}, { projection: { nameKey: 0 } })
      .sort({ machineName: 1 })
      .toArray();
    res.json({ list });
  } catch (e) {
    console.error('[maquinas:list]', e);
    res.status(500).json({ message: 'No se pudieron listar las máquinas' });
  }
});

// BUSCAR POR NOMBRE (solo lectura)
router.get('/by-name/:name', requireAuth, async (req, res) => {
  try {
    const name = toStr(req.params.name);
    if (!name) return res.status(400).json({ message: 'Nombre requerido' });

    const m = await MACHINES().findOne(
      { nameKey: nameKeyOf(name) },
      { projection: { nameKey: 0 } }
    );
    if (!m) return res.status(404).json({ message: 'No encontrada' });
    res.json(m);
  } catch (e) {
    console.error('[maquinas:by-name]', e);
    res.status(500).json({ message: 'Error buscando máquina' });
  }
});

// CREAR (requiere control)
router.post('/', requireAuth, requireControl, async (req, res) => {
  try {
    const doc = sanitizePayload(req.body);

    // duplicado por nombre
    const exists = await MACHINES().findOne({ nameKey: doc.nameKey });
    if (exists) return res.status(409).json({ message: 'Ya existe una máquina con ese nombre' });

    const now = new Date();
    const toInsert = {
      ...doc,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user?.username || String(req.user?.id || ''),
      updatedBy: req.user?.username || String(req.user?.id || ''),
    };

    const { insertedId } = await MACHINES().insertOne(toInsert);

    // AUDITORÍA
    await logChangeAndTrim({
      userId: req.user?.id,
      username: req.user?.username,
      action: 'create',
      machineId: insertedId,
      machineName: toInsert.machineName,
      before: null,
      after: pickMachineFields(toInsert),
    }, 3);

    res.json({ ok: true, _id: insertedId });
  } catch (e) {
    console.error('[maquinas:create]', e);
    const status = e.status || (String(e?.message || '').includes('duplicate') ? 409 : 500);
    res.status(status).json({ message: e.message || 'Error creando máquina' });
  }
});

// ACTUALIZAR (requiere control)
router.put('/:id', requireAuth, requireControl, async (req, res) => {
  try {
    const _id = new ObjectId(req.params.id);
    const payload = sanitizePayload(req.body);

    // before
    const before = await MACHINES().findOne({ _id });
    if (!before) return res.status(404).json({ message: 'Máquina no encontrada' });

    // duplicado por nombre (si cambió)
    const dup = await MACHINES().findOne({ nameKey: payload.nameKey, _id: { $ne: _id } });
    if (dup) return res.status(409).json({ message: 'Ya existe una máquina con ese nombre' });

    const now = new Date();
    const set = {
      ...payload,
      updatedAt: now,
      updatedBy: req.user?.username || String(req.user?.id || ''),
    };

    await MACHINES().updateOne({ _id }, { $set: set });

    // after
    const after = await MACHINES().findOne({ _id });

    // AUDITORÍA
    await logChangeAndTrim({
      userId: req.user?.id,
      username: req.user?.username,
      action: 'update',
      machineId: _id,
      machineName: after?.machineName || before?.machineName,
      before: pickMachineFields(before),
      after: pickMachineFields(after),
    }, 3);

    res.json({ ok: true });
  } catch (e) {
    console.error('[maquinas:update]', e);
    const status = e.status || 500;
    res.status(status).json({ message: e.message || 'Error guardando cambios' });
  }
});

// ELIMINAR (requiere control)
router.delete('/:id', requireAuth, requireControl, async (req, res) => {
  try {
    const _id = new ObjectId(req.params.id);
    const before = await MACHINES().findOne({ _id });
    if (!before) return res.status(404).json({ message: 'Máquina no encontrada' });

    await MACHINES().deleteOne({ _id });

    // AUDITORÍA
    await logChangeAndTrim({
      userId: req.user?.id,
      username: req.user?.username,
      action: 'delete',
      machineId: _id,
      machineName: before.machineName,
      before: pickMachineFields(before),
      after: null,
    }, 3);

    res.json({ ok: true });
  } catch (e) {
    console.error('[maquinas:delete]', e);
    res.status(500).json({ message: 'Error eliminando máquina' });
  }
});

module.exports = router;
