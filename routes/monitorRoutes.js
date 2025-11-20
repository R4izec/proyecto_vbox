const express = require('express');
const router = express.Router();
const fs   = require('fs');
const fsp  = fs.promises;
const path = require('path');
const { getCollection } = require('../services/db');
const { VBoxClient }   = require('../services/vboxClient');
let requireAuth = require('../middleware/requireAuth'); // Asume que exporta una función
if (requireAuth && requireAuth.default) requireAuth = requireAuth.default; // Para compatibilidad ES6 module
if (requireAuth && requireAuth.requireAuth) requireAuth = requireAuth.requireAuth; // Para compatibilidad commonjs module.exports={requireAuth}

const norm = (s) => (s ?? '').toString().trim();
const lc   = (s) => norm(s).toLowerCase();
const pad2 = (n) => String(n).padStart(2, '0');

function mapCfgToTags(cfg) {
  const list = cfg?.cfgList || cfg?.list || [];
  const byName = {};
  for (const it of list) {
    if (!it) continue;
    const n = lc(it.monitorName || it.name || '');
    if (!n) continue;
    byName[n] = it;
  }
  const pick = (...names) => {
    for (const n of names) {
      const hit = byName[lc(n)];
      if (hit) return { id: hit.monitorId || hit.id || null, name: hit.monitorName || hit.name || n };
    }
    return null;
  };
  return {
    contador:    pick('CONTADOR GENERAL', 'contador general', 'COUNTER', 'TOTAL COUNT'),
    funcionando: pick('FUNCIONANDO', 'RUNNING'),
    emergencia:  pick('ESTADO EMERGENCIA', 'EMERGENCIA', 'EMERGENCY'),
    ladoA:       pick('LADO A FUNCIONANDO', 'LADO A', 'SIDE A RUNNING'),
    ladoB:       pick('LADO B FUNCIONANDO', 'LADO B', 'SIDE B RUNNING'),
  };
}
function firstKey(obj, ...cands) {
  if (!obj) return undefined;
  const lower = {};
  for (const [k, v] of Object.entries(obj)) lower[lc(k)] = v;
  for (const c of cands) {
    const v = lower[lc(c)];
    if (v !== undefined) return v;
  }
  return undefined;
}

const KEEPALIVE_MS = Number(process.env.WECON_SWITCH_EVERY_MS || 20000);
const lastSwitchAt = new Map(); // boxId -> ts
async function maybeKeepAlive(client, boxId) {
  const ts = Date.now();
  const last = lastSwitchAt.get(boxId) || 0;
  if (ts - last >= KEEPALIVE_MS) {
    try {
      await client.sendSwitchToDevice?.({ boxId });
      lastSwitchAt.set(boxId, ts);
    } catch (e) {
      console.warn('[monitor] keep-alive failed (non-critical):', e.message);
    }
  }
}

async function makeClientFromUser(req) {
  const sid = req.get('x-vbox-sid') || '';
  const userJwt = req.user || {};
  const usr = await getCollection('users').findOne({ username: userJwt.username });
  if (!usr) throw Object.assign(new Error('No autorizado'), { status: 401 });

  const client = new VBoxClient({
    comid:  usr.comid,
    comkey: usr.comkey,
    region: process.env.WECON_REGION || 'eu',
    base:   process.env.WECON_BASE || '',
    debug:  process.env.WECON_DEBUG === '1'
  });
  if (sid) client.setSid(sid);
  return client;
}

function flattenBoxList(data) {
  const groups = data?.result?.list || data?.list || [];
  const rows = [];
  for (const g of groups) for (const b of (g.boxList || [])) rows.push(b);
  return rows;
}

// Middleware de autenticación para todas las rutas de este router
router.use(requireAuth);

router.get('/boxes', async (req, res) => {
  try {
    const client = await makeClientFromUser(req);
    const data = await client.getBoxes();
    return res.json(data);
  } catch (e) {
    console.error('[monitor/boxes]', e);
    return res.status(e.status || 502).json({ message: e.message || 'Error obteniendo boxes' });
  }
});

router.get('/tagcfg', async (req, res) => {
  try {
    const boxId = norm(req.query.boxId);
    if (!boxId) return res.status(400).json({ message: 'boxId requerido' });

    const client = await makeClientFromUser(req);
    const cfg = await client.getRealtimeCfgList({ boxId, page: 1, pageSize: 100 }).catch(() => ({ list: [] })); // Ajustado para API V2
    const tags = mapCfgToTags(cfg);
    return res.json({ tags, raw: cfg });
  } catch (e) {
    console.warn('[monitor/tagcfg] Fallback a tags vacíos:', e.message);
    return res.json({ tags: {}, raw: { list: [] } }); // Ajustado para API V2
  }
});


router.get('/realtime', async (req, res) => {
  try {
    const boxId = norm(req.query.boxId);
    const names = norm(req.query.names);
    if (!boxId) return res.status(400).json({ message: 'boxId requerido' });

    const keys = names ? names.split(',').map(s => s.trim()).filter(Boolean) : [];

    const client = await makeClientFromUser(req);
    await maybeKeepAlive(client, boxId);

    const map = await client.getRealtime({ boxId, keys }); // Asume API V2

    const raw          = map || {};
    // Usar firstKey con claves en minúsculas para mayor robustez
    const contador     = firstKey(raw, 'contador general', 'counter', 'total count');
    const funcionando  = firstKey(raw, 'funcionando', 'running');
    const emergencia   = firstKey(raw, 'estado emergencia', 'emergencia', 'emergency');
    const ladoA        = firstKey(raw, 'lado a funcionando', 'lado a', 'side a running');
    const ladoB        = firstKey(raw, 'lado b funcionando', 'lado b', 'side b running');

    return res.json({
      raw,
      contador: contador ?? null,
      funcionando: funcionando ?? null,
      emergencia:  emergencia ?? null,
      ladoA:       ladoA ?? 0,
      ladoB:       ladoB ?? 0,
    });
  } catch (e) {
    console.error('[monitor/realtime]', e);
    // Manejar errores específicos de Wecon si es posible
    const status = e.message?.includes('offline') ? 503 : (e.status || 502);
    return res.status(status).json({ message: e.message || 'Error obteniendo realtime' });
  }
});

router.get('/initial-counters', async (req, res) => {
  try {
    const col = getCollection('machines');
    const list = await col.find({}).project({ _id: 0, machineName: 1, initialCounter: 1 }).toArray();
    return res.json({ list });
  } catch (e) {
    console.warn('[monitor/initial-counters]', e.message);
    return res.json({ list: [] });
  }
});

function formatDateExcel(dateValue) {
    if (!dateValue) return '—';
    try {
        const d = new Date(dateValue);
        // Usar UTC para consistencia si la fecha viene con Z
        const yyyy = d.getUTCFullYear();
        const mm = pad2(d.getUTCMonth() + 1);
        const dd = pad2(d.getUTCDate());
        // Validar año para evitar fechas por defecto (epoch)
        if (isNaN(d.getTime()) || yyyy < 2000) return '—';
        return `${yyyy}-${mm}-${dd}`;
    } catch {
        return '—';
    }
}


router.post('/export.xlsx', async (req, res) => {
  try {
    const { boxIds = [] } = req.body || {};
    if (!Array.isArray(boxIds) || boxIds.length === 0) {
      return res.status(400).json({ message: 'Sin máquinas para exportar.' });
    }

    const client = await makeClientFromUser(req); // Autentica y obtiene cliente
    const boxesData = await client.getBoxes();
    const boxes = flattenBoxList(boxesData); // Lista de { boxId, boxName, state } de Wecon
    const byId = new Map(boxes.map(b => [String(b.boxId), b]));

    // Obtener metadatos de TODAS las máquinas de la BD
    const colMachines = getCollection('machines');
    const machinesDocs = await colMachines.find({}).project({
      _id: 0, machineName: 1, initialCounter: 1, company: 1, provider: 1,
      type: 1, startDate: 1 // Incluir type y startDate
    }).toArray();

    // Crear Maps para búsqueda rápida por machineName (lowercase)
    const initByName = new Map();
    const typeByName = new Map();
    const compByName = new Map();
    const provByName = new Map();
    const startDateByName = new Map();

    for (const m of machinesDocs) {
      const k1 = String(m.machineName || '').toLowerCase();
      if (k1) {
        initByName.set(k1, Number.isFinite(m.initialCounter) ? Number(m.initialCounter) : null); // Guardar como número o null
        if (m.type) typeByName.set(k1, String(m.type));
        if (m.company) compByName.set(k1, String(m.company));
        if (m.provider) provByName.set(k1, String(m.provider));
        if (m.startDate) startDateByName.set(k1, m.startDate); // Guardar la fecha (puede ser Date object o string ISO)
      }
    }
    // Funciones helper para obtener datos por nombre (lowercase)
    const getInit = (machineName) => initByName.get(String(machineName||'').toLowerCase()) ?? null;
    const getType = (machineName) => typeByName.get(String(machineName||'').toLowerCase()) || '—';
    const getComp = (machineName) => compByName.get(String(machineName||'').toLowerCase()) || '—';
    const getProv = (machineName) => provByName.get(String(machineName||'').toLowerCase()) || '—';
    const getStartDate = (machineName) => startDateByName.get(String(machineName||'').toLowerCase()) || null;

    // Función para obtener C. Temporada y Estado actual
    const DEFAULT_KEYS = ['CONTADOR GENERAL','FUNCIONANDO','ESTADO EMERGENCIA','LADO A FUNCIONANDO','LADO B FUNCIONANDO'];
    const TAG_NAMES_LOWER = { // Claves esperadas en minúscula
        contador: 'contador general',
        funcionando: 'funcionando',
        emergencia: 'estado emergencia',
        ladoa: 'lado a funcionando',
        ladob: 'lado b funcionando'
    };

    async function getSeasonAndFlags(boxId, machineName) {
        try {
          await maybeKeepAlive(client, boxId);
          let namesToFetch = DEFAULT_KEYS; // Por defecto
          try {
            const cfg = await client.getRealtimeCfgList({ boxId, page:1, pageSize:100 }).catch(()=>({list:[]}));
            const tags = mapCfgToTags(cfg); // Obtiene { contador: {name: '...'}, ... }
            const specificNames = Object.values(tags).map(t => t?.name).filter(Boolean);
            if (specificNames.length > 0) namesToFetch = specificNames;
          } catch(cfgErr) { console.warn(`Error getting tag config for ${boxId}, using defaults: ${cfgErr.message}`) }

          const map = await client.getRealtime({ boxId, keys: namesToFetch });
          const rtDataLower = {}; // Convertir claves a minúsculas para búsqueda robusta
          for (const key in map) { rtDataLower[key.toLowerCase()] = map[key]; }

          // Buscar valores usando las claves en minúscula esperadas
          const contadorVal = rtDataLower[TAG_NAMES_LOWER.contador];
          const funcionandoVal = rtDataLower[TAG_NAMES_LOWER.funcionando];
          const emergenciaVal = rtDataLower[TAG_NAMES_LOWER.emergencia];
          const ladoAVal = rtDataLower[TAG_NAMES_LOWER.ladoa];
          const ladoBVal = rtDataLower[TAG_NAMES_LOWER.ladob];

          const init = getInit(machineName); // Obtener contador inicial (ya es número o null)
          const contadorNum = (contadorVal !== null && contadorVal !== undefined && !isNaN(Number(contadorVal))) ? Number(contadorVal) : null;
          const season = (init !== null && contadorNum !== null) ? Math.max(0, contadorNum - init) : null;

          return {
            season,
            funcionando: funcionandoVal ?? null,
            emergencia:  emergenciaVal ?? null,
            ladoA:       ladoAVal ?? 0,
            ladoB:       ladoBVal ?? 0
          };
        } catch (e) {
          console.warn(`[export.xlsx] Error getting realtime for ${boxId} (${machineName}):`, e.message);
          return { season: null, funcionando: null, emergencia: null, ladoA: 0, ladoB: 0 }; // Devolver nulls
        }
    }
    function estadoBadgeText({ funcionando=null, emergencia=null, ladoA=0, ladoB=0 }) {
        const a = Number(ladoA) === 1, b = Number(ladoB) === 1, emer = Number(emergencia) === 1, func = Number(funcionando) === 1;
        if (emer) return 'Emergencia';
        if (a && b) return 'Operativo completo';
        if (a && !b) return 'Operativo lado A';
        if (b && !a) return 'Operativo lado B';
        if (func) return 'Operativo';
        return 'Sin Operación';
    }

    // Filtrar boxes según los IDs solicitados
    const targets = boxIds.map(id => byId.get(String(id))).filter(Boolean);

    // Generar datos para las filas del Excel
    const rows = [];
    for (const b of targets) { // b es { boxId, boxName, state }
      const flags = await getSeasonAndFlags(b.boxId, b.boxName);
      rows.push({
        maquina:   b.boxName,
        tipo:      getType(b.boxName),
        empresa:   getComp(b.boxName),
        prestador: getProv(b.boxName),
        fecha:     formatDateExcel(getStartDate(b.boxName)), // Añadir fecha formateada
        temporada: flags.season, // Puede ser null
        conexion:  Number(b.state) === 1 ? 'En línea' : 'Fuera de línea',
        estado:    estadoBadgeText(flags),
      });
    }

    // Generar Excel
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'CSF Monitoreo'; wb.created = new Date();
    const ws = wb.addWorksheet('Resumen', {
      properties: { defaultRowHeight: 18 },
      views: [{ state: 'frozen', ySplit: 7 }]
    });

    // Encabezado Archivo
    const stamp = new Date();
    const stampStr = `${stamp.getFullYear()}-${pad2(stamp.getMonth()+1)}-${pad2(stamp.getDate())} ${pad2(stamp.getHours())}:${pad2(stamp.getMinutes())}`;
    ws.mergeCells('A1', 'H1'); // 8 columnas
    ws.getCell('A1').value = 'Monitoreo de Máquinas'; ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = 'Fecha de exportación:'; ws.getCell('B2').value = stampStr;
    ws.getCell('A3').value = 'Máquinas (filtradas):'; ws.getCell('B3').value = rows.length;
    const totalSeason = rows.reduce((acc, r) => acc + (Number.isFinite(r.temporada) ? r.temporada : 0), 0);
    ws.getCell('A4').value = 'Suma C. temporada:'; ws.getCell('B4').value = totalSeason; ws.getCell('B4').numFmt = '#,##0';

    // Encabezado Tabla
    const headerRowIndex = 7;
    const header = ['Máquina','Tipo','Empresa','Prestador','Fecha','C. temporada','Conexión','Estado']; // 8 headers
    ws.getRow(headerRowIndex).values = header; ws.getRow(headerRowIndex).font = { bold: true };
    ws.autoFilter = { from: { row: headerRowIndex, column: 1 }, to: { row: headerRowIndex, column: header.length } };

    // Datos Tabla
    const startRow = headerRowIndex + 1;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      ws.getRow(startRow + i).values = [
        r.maquina, r.tipo, r.empresa, r.prestador, r.fecha, // Añadir fecha
        Number.isFinite(r.temporada) ? r.temporada : null, // C. Temporada o null
        r.conexion, r.estado
      ];
    }

    // Anchos y Formatos Columnas
    const widths = [22, 15, 20, 24, 14, 16, 16, 18]; // 8 anchos
    widths.forEach((w, idx) => ws.getColumn(idx+1).width = w);
    // ws.getColumn(5).numFmt = 'yyyy-mm-dd'; // Formato fecha si se pasó Date object
    ws.getColumn(6).numFmt = '#,##0'; // C. Temporada ahora es columna 6

    // Bordes Tabla
    const totalRows = rows.length;
    for (let r = headerRowIndex; r <= headerRowIndex + totalRows; r++) {
      for (let c = 1; c <= header.length; c++) { // Iterar hasta 8
        ws.getCell(r, c).border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
      }
    }

    // Guardar y Enviar
    const fname = `datos_maquinas_${stamp.getFullYear()}-${pad2(stamp.getMonth()+1)}-${pad2(stamp.getDate())}_${pad2(stamp.getHours())}-${pad2(stamp.getMinutes())}.xlsx`;
    const exportsDir = path.resolve(__dirname, '..', 'exports'); // Directorio 'exports' fuera de 'routes'
    const filePath   = path.join(exportsDir, fname);

    await fsp.mkdir(exportsDir, { recursive: true });
    const nodeBuf = await wb.xlsx.writeBuffer();
    await fsp.writeFile(filePath, nodeBuf); // Guardar copia

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheet.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.end(nodeBuf); // Enviar al cliente

  } catch (e) {
    console.error('[monitor/export.xlsx]', e);
    if (!res.headersSent) { // Solo enviar JSON si no se ha empezado a enviar el archivo
        return res.status(e.status || 500).json({ message: e.message || 'No se pudo generar el Excel' });
    }
  }
});

module.exports = router;