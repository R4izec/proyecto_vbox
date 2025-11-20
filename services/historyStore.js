// services/historyStore.js
'use strict';

const { getCollection } = require('./db');

const COLL_DAY = 'history_day';
const COLL_RANGE = 'history_range';

let _ensured = false;
async function ensureHistoryIndexes() {
  if (_ensured) return;
  const dayCol = await getCollection(COLL_DAY);
  const rangeCol = await getCollection(COLL_RANGE);

  await dayCol.createIndex({ boxId: 1, day: 1 }, { unique: true });
  await dayCol.createIndex({ boxId: 1, updatedAt: -1 });
  await dayCol.createIndex({ day: 1 });

  await rangeCol.createIndex({ boxId: 1, start: 1, end: 1 }, { unique: true });

  _ensured = true;
}

/* ==== DAY DOCS ==== */
async function getDayDoc(boxId, dayISO) {
  await ensureHistoryIndexes();
  const col = await getCollection(COLL_DAY);
  return col.findOne({ boxId: String(boxId), day: dayISO });
}

async function upsertDayDoc(doc) {
  await ensureHistoryIndexes();
  const col = await getCollection(COLL_DAY);
  const { boxId, day } = doc;
  const now = new Date();
  const toSet = {
    ...doc,
    boxId: String(boxId),
    day,
    updatedAt: now,
  };
  await col.updateOne(
    { boxId: String(boxId), day },
    { $set: toSet, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  return getDayDoc(boxId, day);
}

async function getManyDayDocs(boxId, days) {
  await ensureHistoryIndexes();
  const col = await getCollection(COLL_DAY);
  return col.find({ boxId: String(boxId), day: { $in: days } }).toArray();
}

/* ==== RANGE DOCS ==== */
async function getRangeDoc(boxId, startISO, endISO) {
  await ensureHistoryIndexes();
  const col = await getCollection(COLL_RANGE);
  return col.findOne({ boxId: String(boxId), start: startISO, end: endISO });
}

async function upsertRangeDoc(boxId, startISO, endISO, daysSummary) {
  await ensureHistoryIndexes();
  const col = await getCollection(COLL_RANGE);
  const now = new Date();
  const doc = {
    boxId: String(boxId),
    start: startISO,
    end: endISO,
    days: (daysSummary || []).map(d => ({
      day: d.day,
      contadorDiaTicks: Number(d.contadorDiaTicks || 0),
    })),
    updatedAt: now,
  };
  await col.updateOne(
    { boxId: String(boxId), start: startISO, end: endISO },
    { $set: doc, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  return getRangeDoc(boxId, startISO, endISO);
}

/* ---------- Sanitización opcional ---------- */
async function fixUndefinedDayDocs(boxId, days) {
  await ensureHistoryIndexes();
  const col = await getCollection(COLL_DAY);
  await col.updateMany(
    { boxId: { $in: [null, undefined, 'undefined'] }, day: { $in: days } },
    { $set: { boxId: String(boxId) } }
  );
}

module.exports = {
  ensureHistoryIndexes,
  getDayDoc,
  upsertDayDoc,
  getManyDayDocs,
  getRangeDoc,
  upsertRangeDoc,
  fixUndefinedDayDocs,
  COLL_DAY,
  COLL_RANGE,
};
