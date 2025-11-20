// routes/exports.js
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

// ======== Config export dir ========
const EXPORT_DIR = process.env.EXPORT_DIR || path.join(process.cwd(), 'exports');

// ======== Helpers de nombres / paths ========
function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[/\\]/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 180) || `export_${Date.now()}.dat`;
}

function safeJoinExport(fileName) {
  const safe = sanitizeFilename(fileName);
  const full = path.normalize(path.join(EXPORT_DIR, safe));
  if (!full.startsWith(path.normalize(EXPORT_DIR + path.sep))) throw new Error('Ruta inválida');
  return full;
}

function inferTypeFromName(name) {
  const n = (name || '').toLowerCase();
  if (n.startsWith('datos_maquinas_')) return 'general';
  if (/^(informe_)?semanal/.test(n) || /weekly/.test(n) || /^historicos_/.test(n)) return 'weekly';
  return 'other';
}

function guessContentType(file) {
  const ext = (file.split('.').pop() || '').toLowerCase();
  if (ext === 'csv') return 'text/csv; charset=utf-8';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === 'json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function readMetaFor(filePath) {
  const metaPath = filePath + '.meta.json';
  try {
    const buf = await fs.promises.readFile(metaPath, 'utf-8');
    const j = JSON.parse(buf);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

// ======== LISTAR EXPORTS (.xlsx y .csv) ========
router.get('/list', async (req, res) => {
  try {
    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });

    const entries = await fs.promises.readdir(EXPORT_DIR, { withFileTypes: true });

    const names = entries
      .filter(e => e.isFile() && /\.(xlsx|csv)$/i.test(e.name))
      .map(e => e.name);

    const items = [];
    for (const filename of names) {
      const full = path.join(EXPORT_DIR, filename);
      const st = await fs.promises.stat(full).catch(() => null);
      if (!st) continue;

      const meta = await readMetaFor(full); // puede no existir (OK)
      const ext = (filename.split('.').pop() || '').toLowerCase();

      const item = {
        filename,
        size: st.size,
        mtime: st.mtime,
        ctime: st.ctime,
        createdAt: meta?.createdAt || st.birthtime || st.ctime || st.mtime,
        url: `/api/exports/file/${encodeURIComponent(filename)}`,
        type: meta?.type || inferTypeFromName(filename),
        user: meta?.user || null,
        ext
      };
      items.push(item);
    }

    const wantType = String(req.query.type || '').trim();
    const list = wantType ? items.filter(it => (it.type || '') === wantType) : items;

    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ ok: true, items: list });
  } catch (err) {
    console.error('[exports/list] Error:', err);
    res.status(500).json({ ok: false, message: 'No se pudo listar exports' });
  }
});

// ======== DESCARGAR ARCHIVO (xlsx/csv) ========
router.get('/file/:name', async (req, res) => {
  try {
    const full = safeJoinExport(req.params.name);
    await fs.promises.access(full, fs.constants.R_OK);

    res.setHeader('Content-Type', guessContentType(full));
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(full)}"`);
    fs.createReadStream(full).pipe(res);
  } catch (err) {
    console.error('[exports/file] Error:', err);
    res.status(404).json({ ok: false, message: 'Archivo no encontrado' });
  }
});

module.exports = router;
