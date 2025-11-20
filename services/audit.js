// services/audit.js
const { getCollection } = require('./db');

const CHANGES = () => getCollection('changes');

const DEFAULT_TZ = process.env.APP_TZ || 'America/Santiago';

// -------- helpers de zona/offset --------
function getOffsetMinutes(date, timeZone) {
  // 1) intenta con shortOffset (p.ej. "GMT-4" o "UTC-04:00")
  try {
    const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' });
    const tzName = dtf.formatToParts(date).find(p => p.type === 'timeZoneName')?.value || '';
    const m = tzName.match(/([+-]\d{1,2})(?::?(\d{2}))?/); // -4 o -04:00
    if (m) {
      const h = parseInt(m[1], 10);
      const mm = parseInt(m[2] || '0', 10);
      return h * 60 + (h >= 0 ? mm : -mm);
    }
  } catch (_) {}

  // 2) fallback robusto: calcula el offset real del tz en ese instante
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).map(x => [x.type, x.value])
  );
  const localAsUTC = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000Z`);
  const offsetMs = localAsUTC.getTime() - date.getTime();
  return -Math.round(offsetMs / 60000);
}

function offsetToStr(mins) {
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}:${mm}`;
}

function formatLocalISO(date, timeZone = DEFAULT_TZ) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).map(x => [x.type, x.value])
  );
  const base = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  const off = offsetToStr(getOffsetMinutes(date, timeZone));
  return `${base}${off}`;
}

function localStamp(date = new Date(), timeZone = DEFAULT_TZ) {
  return {
    createdAt: date,                           // Date (UTC en Mongo)
    createdAtLocal: formatLocalISO(date, timeZone), // ISO local con offset
    tz: timeZone,
    offsetMinutes: getOffsetMinutes(date, timeZone)
  };
}

// -------- índices --------
let _idxReady = false;
async function ensureIndexes() {
  if (_idxReady) return;
  try {
    await CHANGES().createIndex({ userId: 1, createdAt: -1 });
  } catch (_) {}
  _idxReady = true;
}
ensureIndexes();

function pickMachineFields(doc = {}) {
  return {
    machineName: doc.machineName ?? null,
    company: doc.company ?? null,
    provider: doc.provider ?? null,
    startDate: doc.startDate ?? null,
    initialCounter: doc.initialCounter ?? null,
    // si guardamos local en machines, lo reflejamos también en auditoría:
    createdAtLocal: doc.createdAtLocal ?? null,
    updatedAtLocal: doc.updatedAtLocal ?? null,
    tz: doc.tz ?? null
  };
}

/**
 * Registra un cambio y mantiene sólo los últimos `keep` por usuario (default 3).
 */
async function logChangeAndTrim({
  userId,
  username,
  action,             // 'create' | 'update' | 'delete'
  machineId,
  machineName,
  before = null,
  after = null,
}, keep = 3) {
  await ensureIndexes();

  const now = localStamp();

  const doc = {
    userId: String(userId || ''),
    username: String(username || ''),
    action,
    machineId: machineId ? String(machineId) : null,
    machineName: machineName || (after?.machineName ?? before?.machineName) || null,
    before: before ? pickMachineFields(before) : null,
    after: after ? pickMachineFields(after) : null,
    createdAt: now.createdAt,           // Date (UTC en Mongo)
    createdAtLocal: now.createdAtLocal, // ISO con offset: 2025-09-01T13:00:53-04:00
    tz: now.tz,
    offsetMinutes: now.offsetMinutes
  };

  await CHANGES().insertOne(doc);

  // recorta a los últimos N por usuario
  const extra = await CHANGES()
    .find({ userId: doc.userId }, { projection: { _id: 1 } })
    .sort({ createdAt: -1 })
    .skip(keep)
    .toArray();

  if (extra.length) {
    await CHANGES().deleteMany({ _id: { $in: extra.map(x => x._id) } });
  }
}

module.exports = { CHANGES, logChangeAndTrim, pickMachineFields, localStamp, formatLocalISO };
