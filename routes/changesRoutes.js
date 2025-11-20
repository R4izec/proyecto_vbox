// routes/changesRoutes.js
const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { CHANGES } = require('../services/audit');

const router = express.Router();
const TZ = process.env.APP_TZ || 'America/Santiago';

function toLocalString(d, tz = TZ) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: tz, dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(d));
}

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const list = await CHANGES()
      .find({ userId: String(req.user.id) })
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();

    const out = list.map(x => ({
      ...x,
      createdAtLocal: toLocalString(x.createdAt, TZ)  // <- sin desfase
    }));

    res.json({ list: out });
  } catch (e) {
    console.error('[changes:mine]', e);
    res.status(500).json({ message: 'Error listando cambios' });
  }
});

module.exports = router;
