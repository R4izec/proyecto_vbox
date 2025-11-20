'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const router = express.Router();
const { getCollection } = require('../services/db');
const { VBoxClient } = require('../services/vboxClient');

/* ================== Parámetros ================== */
const EXPORT_DIR = process.env.EXPORT_DIR || path.join(process.cwd(), 'exports');

// ===== CAMBIO: Ya NO usamos DAY_START_H y DAY_END_H =====
// Ahora detectamos automáticamente basado en producción real

/* ================== Helpers ================== */
const norm = (s) => (s ?? '').toString().trim();
const pad2 = (n) => String(n).padStart(2, '0');
const parseN = (v) => {
  if (v === '' || v === null || v === undefined) return NaN;
  return Number(String(v).replace(',', '.'));
};

function sanitizeFilename(s = '') {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '').replace(/\s+/g, ' ').trim().replace(/\s/g, '_').slice(0, 180);
}

/* === Chile DST simple === */
function firstSundayUTC(year, month) {
  const d = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const add = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(1 + add);
  return d;
}

function isChileDST(y, m, d) {
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dstStart = firstSundayUTC(y, 9);
  const dstEnd = firstSundayUTC(y + 1, 4);
  return probe >= dstStart && probe < dstEnd;
}

function toUTCFromCL(y, m, d, h = 0, mi = 0) {
  const off = isChileDST(y, m, d) ? 3 : 4; // UTC-3 verano, UTC-4 invierno
  return new Date(Date.UTC(y, m - 1, d, h + off, mi, 0, 0));
}

function dayBoundsChileUTC(dayISO) {
  const [y, m, d] = dayISO.split('-').map(Number);
  return {
    y, m, d,
    isDST: isChileDST(y, m, d),
    b: toUTCFromCL(y, m, d, 0, 0),
    e: toUTCFromCL(y, m, d, 24, 0)
  };
}

function todayISOChile() {
  const now = new Date();
  const off = isChileDST(now.getFullYear(), now.getMonth() + 1, now.getDate()) ? 3 : 4;
  const cl = new Date(now.getTime() - off * 60 * 60 * 1000);
  return `${cl.getUTCFullYear()}-${pad2(cl.getUTCMonth() + 1)}-${pad2(cl.getUTCDate())}`;
}

/* ================== Wecon helpers ================== */
async function getAllHistory(client, monitorId, begin, end) {
  const first = await client.getHistoryData({ monitorId, begin, end, pageIndex: 1, pageSize: 500 });
  let rows = first.list || [];
  const total = Number(first.totalPage || 1);
  for (let p = 2; p <= total; p++) {
    const r = await client.getHistoryData({ monitorId, begin, end, pageIndex: p, pageSize: 500 }).catch(() => ({ list: [] }));
    rows.push(...(r.list || []));
  }
  rows.sort((a, b) => {
    const ta = a.monitorTime ?? Date.parse(String(a.monitorTime_show).replace(' ', 'T'));
    const tb = b.monitorTime ?? Date.parse(String(b.monitorTime_show).replace(' ', 'T'));
    return ta - tb;
  });
  return rows;
}

/* ================== Procesamiento por minuto ================== */
const toMinute = (ms) => Math.floor(ms / 60000) * 60000;

function collapseToMinuteMap(rows) {
  const map = new Map();
  for (const r of rows) {
    const t = (typeof r.monitorTime === 'number') ? r.monitorTime : (r.monitorTime_show ? Date.parse(String(r.monitorTime_show).replace(' ', 'T')) : NaN);
    const rawValueStr = String(r.value ?? '');
    let v = parseN(rawValueStr);
    if (rawValueStr.includes('.')) {
      v = v * 10;
    }
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    map.set(toMinute(t), v);
  }
  return map;
}

function detectDivisor(minMap) {
  const keys = Array.from(minMap.keys()).sort((a, b) => a - b);
  const deltas = [];
  for (let i = 1; i < keys.length; i++) {
    const dv = minMap.get(keys[i]) - minMap.get(keys[i - 1]);
    if (Number.isFinite(dv) && dv > 0) deltas.push(dv);
  }
  if (deltas.length < 10) return 1;
  const hist = new Map();
  for (const d of deltas) {
    const s = Math.abs(d).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
    const i = s.indexOf('.');
    const dec = i < 0 ? 0 : s.length - i - 1;
    hist.set(dec, (hist.get(dec) || 0) + 1);
  }
  if (hist.size === 0) return 1;
  let bestDec = 0, bestCnt = 0, total = 0;
  for (const [k, c] of hist) {
    total += c;
    if (c > bestCnt) {
      bestCnt = c;
      bestDec = k;
    }
  }
  if (bestDec === 0 && hist.size > 1) {
    hist.delete(0);
    bestDec = 0;
    bestCnt = 0;
    for (const [k, c] of hist) {
      if (c > bestCnt) {
        bestCnt = c;
      }
    }
  }
  const ratio = total ? bestCnt / total : 0;
  return (ratio >= 0.6 && bestDec > 0) ? Math.pow(10, Math.min(3, bestDec)) : 1;
}

function buildMinuteDeltas(minMap, divisor = 1) {
  const keys = Array.from(minMap.keys()).sort((a, b) => a - b);
  const out = new Map();
  for (let i = 1; i < keys.length; i++) {
    const v0 = minMap.get(keys[i - 1]);
    const v1 = minMap.get(keys[i]);
    let dv = v1 - v0;
    if (!Number.isFinite(dv) || dv <= 0) dv = 0;
    out.set(keys[i], dv / (divisor || 1));
  }
  return out;
}

function minuteRangeUTC(y, m, d, h0, h1) {
  const s = toUTCFromCL(y, m, d, h0, 0).getTime();
  const e = toUTCFromCL(y, m, d, h1, 0).getTime();
  const mins = [];
  for (let t = s; t < e; t += 60000) mins.push(t);
  return mins;
}

function sumDayTicks(minDeltaMap, y, m, d) {
  const mins = minuteRangeUTC(y, m, d, 0, 24);
  let sum = 0;
  for (const t of mins) sum += (minDeltaMap.get(t) || 0);
  return Math.round(sum);
}

// ===== NUEVO: Detectar automáticamente inicio y fin de producción =====
function detectProductionWindow(minDeltaMap, y, m, d) {
  const mins = minuteRangeUTC(y, m, d, 0, 24);
  let firstOn = null, lastOff = null;
  let debugLog = [];
  
  for (const t of mins) {
    const dv = minDeltaMap.get(t) || 0;
    if (dv > 0) {
      if (firstOn == null) {
        firstOn = t;
        const d1 = new Date(t);
        debugLog.push(`FIRST ON: ${d1.toISOString()} (UTC) = ${t}`);
      }
      lastOff = t;
    }
  }
  
  if (lastOff) {
    const d2 = new Date(lastOff);
    debugLog.push(`LAST OFF: ${d2.toISOString()} (UTC) = ${lastOff}`);
  }
  
  console.log('[detectProductionWindow]', debugLog.join(' | '));
  
  return { firstOn, lastOff };
}

// ===== NUEVO: Bins horarios dinámicos =====
function hourlyBinsDynamic(minDeltaMap, y, m, d, firstOnUTC, lastOffUTC) {
  if (!Number.isFinite(firstOnUTC) || !Number.isFinite(lastOffUTC)) {
    return { labels: [], values: [] };
  }

  const off = isChileDST(y, m, d) ? 3 : 4;
  
  console.log(`[hourlyBinsDynamic] DST Offset: ${off}h, Date: ${y}-${pad2(m)}-${pad2(d)}`);
  console.log(`[hourlyBinsDynamic] firstOnUTC: ${new Date(firstOnUTC).toISOString()}`);
  console.log(`[hourlyBinsDynamic] lastOffUTC: ${new Date(lastOffUTC).toISOString()}`);
  
  // Convertir UTC a hora local de Chile
  // IMPORTANTE: Calcular el DST para CADA timestamp, no para el día del inicio
  const firstDt = new Date(firstOnUTC);
  const lastDt = new Date(lastOffUTC);
  
  const offFirst = isChileDST(firstDt.getUTCFullYear(), firstDt.getUTCMonth() + 1, firstDt.getUTCDate()) ? 3 : 4;
  const offLast = isChileDST(lastDt.getUTCFullYear(), lastDt.getUTCMonth() + 1, lastDt.getUTCDate()) ? 3 : 4;
  
  const firstLocal = new Date(firstOnUTC - offFirst * 60 * 60 * 1000);
  const lastLocal = new Date(lastOffUTC - offLast * 60 * 60 * 1000);
  
  console.log(`[hourlyBinsDynamic] firstLocal: ${firstLocal.toISOString()} (${firstLocal.getUTCHours()}:${pad2(firstLocal.getUTCMinutes())})`);
  console.log(`[hourlyBinsDynamic] lastLocal: ${lastLocal.toISOString()} (${lastLocal.getUTCHours()}:${pad2(lastLocal.getUTCMinutes())})`);
  
  const hStart = firstLocal.getUTCHours();
  const minStart = firstLocal.getUTCMinutes();
  const hEnd = lastLocal.getUTCHours();
  const minEnd = lastLocal.getUTCMinutes();
  
  const labels = [], values = [];
  
  // Primera hora (puede ser parcial)
  let s = toUTCFromCL(y, m, d, hStart, minStart).getTime();
  let e = toUTCFromCL(y, m, d, hStart + 1, 0).getTime();
  let sum = 0;
  for (let t = s; t < e; t += 60000) {
    sum += (minDeltaMap.get(t) || 0);
  }
  labels.push(`${pad2(hStart)}:${pad2(minStart)}`);
  values.push(Math.round(sum));
  
  // Horas completas intermedias
  for (let hh = hStart + 1; hh < hEnd; hh++) {
    const s = toUTCFromCL(y, m, d, hh, 0).getTime();
    const e = toUTCFromCL(y, m, d, hh + 1, 0).getTime();
    let sum = 0;
    for (let t = s; t < e; t += 60000) {
      sum += (minDeltaMap.get(t) || 0);
    }
    labels.push(`${pad2(hh)}:00`);
    values.push(Math.round(sum));
  }
  
  // Última hora (puede ser parcial)
  if (hEnd > hStart) {
    s = toUTCFromCL(y, m, d, hEnd, 0).getTime();
    e = toUTCFromCL(y, m, d, hEnd, minEnd).getTime();
    sum = 0;
    for (let t = s; t <= e; t += 60000) {
      sum += (minDeltaMap.get(t) || 0);
    }
    labels.push(`${pad2(hEnd)}:${pad2(minEnd)}`);
    values.push(Math.round(sum));
  }
  
  console.log(`[hourlyBinsDynamic] Resultado: ${labels.length} bins, desde ${labels[0]} hasta ${labels[labels.length - 1]}`);
  
  return { labels, values };
}

function buildRunIntervals(minDeltaMap, y, m, d) {
  const mins = minuteRangeUTC(y, m, d, 0, 24);
  const out = [];
  let curStart = null;
  
  for (const t of mins) {
    const dv = minDeltaMap.get(t) || 0;
    if (dv > 0) {
      if (curStart == null) curStart = t;
    } else {
      if (curStart != null) {
        out.push({ start: curStart, end: t });
        curStart = null;
      }
    }
  }
  if (curStart != null) out.push({ start: curStart, end: mins[mins.length - 1] });
  
  return out;
}

function fillBinaryPerMinute(rows, y, m, d) {
  const sUTC = toUTCFromCL(y, m, d, 0, 0).getTime();
  const eUTC = toUTCFromCL(y, m, d, 24, 0).getTime();
  const raw = new Map();
  for (const r of rows) {
    const t = (typeof r.monitorTime === 'number') ? r.monitorTime : (r.monitorTime_show ? Date.parse(String(r.monitorTime_show).replace(' ', 'T')) : NaN);
    if (!Number.isFinite(t)) continue;
    const v = parseN(r.value);
    if (!Number.isFinite(v)) continue;
    raw.set(toMinute(t), v >= 0.5 ? 1 : 0);
  }
  const out = new Map();
  let last = 0;
  for (let t = sUTC; t < eUTC; t += 60000) {
    if (raw.has(t)) last = raw.get(t);
    out.set(t, last);
  }
  return out;
}

function emergStats(emerMinMap, runIntervals) {
  let minEnEmer = 0, veces = 0;
  let prev = 0;
  const stamps = Array.from(emerMinMap.keys()).sort((a, b) => a - b);
  for (const t of stamps) {
    const v = emerMinMap.get(t);
    if (v === 1) {
      for (const it of runIntervals) {
        if (t >= it.start && t < it.end) {
          minEnEmer += 1;
          break;
        }
      }
    }
    if (prev === 0 && v === 1) {
      let inside = false;
      for (const it of runIntervals) {
        if (t >= it.start && t < it.end) {
          inside = true;
          break;
        }
      }
      if (inside) veces += 1;
    }
    prev = v;
  }
  return { minEnEmer, veces };
}

/* ================== Selección por nombre ================== */
function cleanName(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function findMon(list, include) {
  const arr = (list || []).filter(x => {
    const nm = cleanName(x.monitorName || x.name || '');
    return include.some(i => nm.includes(i));
  });
  arr.sort((a, b) => String(a.monitorName || a.name || '').localeCompare(String(b.monitorName || b.name || ''), 'es'));
  return arr[0];
}

const TAG_COUNTER = ['CONTADOR GENERAL', 'CONTADOR', 'COUNTER', 'TOTAL'].map(cleanName);
const TAG_EMER = ['ESTADO EMERGENCIA', 'EMERGENCIA', 'EMERGENCY', 'ALARMA'].map(cleanName);

/* ======================================================================= 
=================== CÁLCULO DE UN DÍA (CON CACHE Y DETECCIÓN AUTOMÁTICA) =
======================================================================= */
async function computeDayDetail(client, boxId, dayISO) {
  const monList = (await client.getMonitors({ boxId })).list || [];
  const monCont = findMon(monList, TAG_COUNTER);
  if (!monCont) throw new Error('No se encontró monitor de contador');
  const monEmer = findMon(monList, TAG_EMER);

  const { y, m, d, b, e } = dayBoundsChileUTC(dayISO);
  const bEx = new Date(+b - 5 * 60 * 1000);
  const eEx = new Date(+e + 5 * 60 * 1000);

  const contRows = await getAllHistory(client, monCont.monitorId || monCont.id, bEx, eEx);
  const contMinMap = collapseToMinuteMap(contRows);
  const divisor = detectDivisor(contMinMap);
  const contDeltaMin = buildMinuteDeltas(contMinMap, divisor);

  // ===== CAMBIO: Detectar automáticamente el rango de producción =====
  const { firstOn, lastOff } = detectProductionWindow(contDeltaMin, y, m, d);
  
  const runBase = buildRunIntervals(contDeltaMin, y, m, d);
  const run = runBase.map(it => ({
    start: it.start,
    end: it.end
  }));

  let totalRunMin = 0;
  for (const it of run) {
    totalRunMin += Math.round((it.end - it.start) / 60000);
  }

  let contadorDiaTicks = sumDayTicks(contDeltaMin, y, m, d);

  const intervals = run.map(it => {
    let produced = 0;
    for (let t = it.start + 60000; t <= it.end; t += 60000) {
      produced += (contDeltaMin.get(t) || 0);
    }
    return {
      start: it.start,
      end: it.end,
      durationMin: Math.round((it.end - it.start) / 60000),
      producedTicks: Math.round(produced),
      emerMin: 0,
      emerCount: 0
    };
  });

  let emerStatsDay = { minEnEmer: 0, veces: 0 };
  if (monEmer) {
    const emerRows = await getAllHistory(client, monEmer.monitorId || monEmer.id, bEx, eEx);
    const emerMinMap = fillBinaryPerMinute(emerRows, y, m, d);
    emerStatsDay = emergStats(emerMinMap, run);
    for (const it of intervals) {
      let min = 0, cnt = 0, prev = 0;
      for (let t = it.start; t < it.end; t += 60000) {
        const v = emerMinMap.get(t) || 0;
        if (v === 1) min += 1;
        if (prev === 0 && v === 1) cnt += 1;
        prev = v;
      }
      it.emerMin = min;
      it.emerCount = cnt;
    }
  }

  const tableTotalEmerg = intervals.reduce((acc, it) => acc + (Number(it.emerCount) || 0), 0);
  if (tableTotalEmerg > 0) emerStatsDay.veces = tableTotalEmerg;

  // ===== CAMBIO: Usar bins dinámicos =====
  const { labels, values } = hourlyBinsDynamic(contDeltaMin, y, m, d, firstOn, lastOff);
  const cumulative = [];
  let acc = 0;
  for (const v of values) {
    acc += Number(v) || 0;
    cumulative.push(acc);
  }

  const avgPerMin = totalRunMin > 0 ? Math.round(contadorDiaTicks / totalRunMin * 10) / 10 : 0;
  const avgPerHour = totalRunMin > 0 ? Math.round((contadorDiaTicks / (totalRunMin / 60))) : 0;

  return {
    boxId: String(boxId),
    day: dayISO,
    emergencias: { veces: emerStatsDay.veces, minutos: emerStatsDay.minEnEmer },
    contadorDiaTicks,
    run: { firstOn: firstOn ?? null, lastOff: lastOff ?? null, totalRunMin, intervals },
    averages: { avgPerHour, avgPerMin },
    bins1h: labels.map((label, i) => ({ label, produced: values[i], cumulative: cumulative[i] })),
    computedAt: new Date(),
    source: 'wecon'
  };
}

/* ===== Cache ===== */
async function getHistoryDaysCol() {
  const col = await getCollection('history_days');
  try {
    await col.createIndex({ boxId: 1, day: 1 }, { unique: true });
  } catch { }
  return col;
}

async function getOrComputeDayDetail(req, boxId, dayISO) {
  const col = await getHistoryDaysCol();
  const isToday = (dayISO === todayISOChile());
  if (!isToday) {
    const cached = await col.findOne({ boxId: String(boxId), day: dayISO });
    if (cached) return { ...cached, source: 'cache' };
  }
  const client = await getClient(req);
  const fresh = await computeDayDetail(client, boxId, dayISO);
  await col.updateOne(
    { boxId: String(boxId), day: dayISO },
    { $set: { ...fresh, source: 'cache', computedAt: new Date() } },
    { upsert: true }
  );
  return { ...fresh, source: isToday ? 'wecon' : 'cache' };
}

async function buildSeriesForRange(req, { boxId, startISO, endISO, nameQ }) {
  const days = listDaysISO(startISO, endISO);
  const labels = [], perDay = [];
  for (const dayISO of days) {
    const det = await getOrComputeDayDetail(req, boxId, dayISO);
    const d = new Date(dayISO);
    const lbl = `${d.toLocaleDateString('es-CL', { weekday: 'short' })}, ${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    labels.push(lbl);
    perDay.push(Number(det?.contadorDiaTicks || 0));
  }
  const client = await getClient(req);
  let resolvedName = nameQ || null;
  if (!resolvedName) {
    try {
      const boxes = await client.getBoxes().catch(() => null);
      const groups = boxes?.result?.list || boxes?.list || [];
      outer: for (const g of groups) for (const b of (g.boxList || [])) {
        if (String(b.boxId) === String(boxId)) {
          resolvedName = b.boxName || b.boxId;
          break outer;
        }
      }
    } catch { }
  }
  let initialCounter = 0;
  if (resolvedName) {
    const doc = await getCollection('machines').findOne({
      machineName: { $regex: new RegExp(`^${resolvedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
    });
    initialCounter = Number(doc?.initialCounter ?? 0);
  }
  return { labels, series: [{ name: 'Contador del día', data: perDay }], scale: 1, initialCounter, machineName: resolvedName || null };
}

/* ================== Auth/Client ================== */
async function getClient(req) {
  const usr = await getCollection('users').findOne({ username: req.user?.username });
  if (!usr) throw Object.assign(new Error('No autorizado'), { status: 401 });
  const client = new VBoxClient({ comid: usr.comid, comkey: usr.comkey, region: 'eu' });
  const sid = req.get?.('x-vbox-sid') || req.headers?.['x-vbox-sid'] || '';
  if (sid) client.setSid(sid);
  return client;
}

/* ================== Util días (local CL) ================== */
function listDaysISO(startISO, endISO) {
  const [y1, m1, d1] = startISO.split('-').map(Number);
  const [y2, m2, d2] = endISO.split('-').map(Number);
  const s = new Date(y1, m1 - 1, d1, 0, 0, 0, 0);
  const e = new Date(y2, m2 - 1, d2, 0, 0, 0, 0);
  const out = [];
  for (let dt = new Date(s); dt.getTime() <= e.getTime(); dt.setDate(dt.getDate() + 1)) {
    out.push(`${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`);
  }
  return out;
}

/* ================== Gráficos (ChartJS en servidor) ================== */
let ChartJSNodeCanvas = null;
try {
  ChartJSNodeCanvas = require('chartjs-node-canvas').ChartJSNodeCanvas;
} catch { /* opcional */ }

const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

const valueLabelsPlugin = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    chart.data.datasets.forEach((ds, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      if (!meta?.data) return;
      meta.data.forEach((elem, i) => {
        const raw = ds.data?.[i];
        if (raw === null || raw === undefined) return;
        const val = Number(raw);
        if (!Number.isFinite(val)) return;
        const { x, y } = elem.tooltipPosition();
        const yOff = (chart.config.type === 'bar' && dsIndex === 0) ? -6 : -8;
        ctx.fillStyle = '#000000';
        ctx.fillText(nf0.format(val), x, y + yOff);
      });
    });
    ctx.restore();
  }
};

async function makeBarLineImage({ labels, bars, line, width = 1000, height = 420 }) {
  if (!ChartJSNodeCanvas) return null;
  const canvas = new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });
  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Producido (día)', data: bars, order: 1, backgroundColor: 'rgba(0,102,254,0.62)' },
        { type: 'line', label: 'Acumulado', data: line, order: 0, borderColor: '#00d5ff', borderWidth: 2, tension: 0.35, pointRadius: 3 }
      ]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: { y: { beginAtZero: true } }
    },
    plugins: [valueLabelsPlugin]
  };
  return await canvas.renderToBuffer(cfg);
}

async function makeTrendImage({ labels, cumulative, width = 1000, height = 320 }) {
  if (!ChartJSNodeCanvas) return null;
  const canvas = new ChartJSNodeCanvas({ width, height, backgroundColour: 'white' });
  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [{ label: 'Acumulado', data: cumulative, borderColor: '#00d5ff', borderWidth: 2, tension: 0.35, pointRadius: 3, fill: false }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    },
    plugins: [valueLabelsPlugin]
  };
  return await canvas.renderToBuffer(cfg);
}

function pixelsPerRow(ws) {
  const rowPt = ws?.properties?.defaultRowHeight || 18;
  return rowPt * (96 / 72);
}

function pixelsToRows(px, ws) {
  return Math.ceil(px / pixelsPerRow(ws));
}

function placeImageBelow(ws, imgId, startRow, { width, height }, col = 0, padRows = 2) {
  ws.addImage(imgId, { tl: { col, row: startRow }, ext: { width, height } });
  const usedRows = pixelsToRows(height, ws);
  return startRow + usedRows + padRows;
}

function monthKeyFromISO(iso) { return iso.slice(0, 7); }

function monthTitleFromKey(key) {
  const [yy, mm] = key.split('-').map(Number);
  const date = new Date(yy, mm - 1, 1);
  const title = date.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function labelFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const dd = pad2(dt.getDate());
  const mm = pad2(dt.getMonth() + 1);
  const dow = dt.toLocaleDateString('es-CL', { weekday: 'short' });
  return `${dow}, ${dd}-${mm}`;
}

function splitMonthlyGroups(daysISO, perDay) {
  const buckets = new Map();
  let accGlobal = 0;
  for (let i = 0; i < daysISO.length; i++) {
    const iso = daysISO[i];
    const val = Number(perDay[i] || 0);
    const k = monthKeyFromISO(iso);
    if (!buckets.has(k)) buckets.set(k, { key: k, title: monthTitleFromKey(k), labels: [], bars: [], line: [] });
    const b = buckets.get(k);
    b.labels.push(labelFromISO(iso));
    b.bars.push(val);
    accGlobal += val;
    b.line.push(accGlobal);
  }
  return [...buckets.values()];
}

/* ================== Rutas ================== */

router.get('/series', async (req, res) => {
  try {
    const boxId = norm(req.query.boxId);
    const startISO = norm(req.query.start);
    const endISO = norm(req.query.end);
    const nameQ = norm(req.query.name || req.query.machineName);
    if (!boxId || !startISO || !endISO) return res.status(400).json({ message: 'boxId, start y end requeridos' });
    const data = await buildSeriesForRange(req, { boxId, startISO, endISO, nameQ });
    res.json(data);
  } catch (e) {
    console.error('[history/series]', e);
    res.status(e.status || 500).json({ message: e.message || 'Error series' });
  }
});

router.get('/daydetail', async (req, res) => {
  try {
    const boxId = norm(req.query.boxId);
    const day = norm(req.query.day);
    if (!boxId || !day) return res.status(400).json({ message: 'boxId y day requeridos' });
    const det = await getOrComputeDayDetail(req, boxId, day);
    res.json(det);
  } catch (e) {
    console.error('[history/daydetail]', e);
    res.status(e.status || 500).json({ message: e.message || 'Error daydetail' });
  }
});

/* ===== Export Excel (SIN gráficos en hoja General) ===== */
router.post('/export', async (req, res) => {
  try {
    const boxId = norm(req.body.boxId);
    const startISO = norm(req.body.start);
    const endISO = norm(req.body.end);
    let mName = norm(req.body.name);

    if (!boxId || !startISO || !endISO) {
      return res.status(400).json({ ok: false, message: 'boxId, start y end requeridos' });
    }

    if (!mName) {
      const client = await getClient(req);
      try {
        const boxes = await client.getBoxes().catch(() => null);
        const groups = boxes?.result?.list || boxes?.list || [];
        outer: for (const g of groups) for (const b of (g.boxList || [])) {
          if (String(b.boxId) === String(boxId)) {
            mName = b.boxName || b.boxId;
            break outer;
          }
        }
      } catch { }
    }

    const safeName = sanitizeFilename(mName || String(boxId));

    // Serie general
    const seriesResp = await buildSeriesForRange(req, { boxId, startISO, endISO, nameQ: mName });
    const genLabels = seriesResp.labels || [];
    const perDay = seriesResp.series?.[0]?.data || [];
    const perDayCum = [];
    let acc = 0;
    for (let i = 0; i < perDay.length; i++) {
      acc += Number(perDay[i]) || 0;
      perDayCum.push(acc);
    }

    // Detalles por día (cache)
    const days = listDaysISO(startISO, endISO);
    const perDayDetails = [];
    for (const dayISO of days) {
      const det = await getOrComputeDayDetail(req, boxId, dayISO).catch(err => ({ __error: err, day: dayISO }));
      perDayDetails.push(det);
    }

    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CSF';
    wb.created = new Date();

    /* ---- Hoja 1: General ---- */
    const wsG = wb.addWorksheet('General');
    wsG.properties.defaultRowHeight = 18;
    wsG.mergeCells('A1', 'F1');
    wsG.getCell('A1').value = `Históricos – ${mName || boxId} (${startISO} a ${endISO})`;
    wsG.getCell('A1').font = { bold: true, size: 14 };
    wsG.getCell('A1').alignment = { vertical: 'middle' };
    wsG.addRow([]);

    const hdrRow = wsG.addRow(['Fecha', 'Producido (día)', 'Acumulado']);
    hdrRow.font = { bold: true };
    wsG.columns = [
      { key: 'fecha', width: 22 },
      { key: 'dia', width: 20, style: { numFmt: '#,##0' } },
      { key: 'acum', width: 18, style: { numFmt: '#,##0' } }
    ];

    for (let i = 0; i < genLabels.length; i++) {
      wsG.addRow({ fecha: genLabels[i], dia: perDay[i] || 0, acum: perDayCum[i] || 0 });
    }

    wsG.addRow([]);
    const totalRango = perDay.reduce((a, b) => a + (Number(b) || 0), 0);
    const kpiRow = wsG.addRow(['Total producido en el rango', totalRango]);
    kpiRow.getCell(1).font = { bold: true };
    kpiRow.getCell(2).numFmt = '#,##0';

    /* ---- Hojas por día (con gráfico de tendencia dinámico) ---- */
    for (const det of perDayDetails) {
      const dayISO = det?.day;
      const title = dayISO || 'día';
      const ws = wb.addWorksheet(title.substring(0, 31));
      ws.properties.defaultRowHeight = 18;
      ws.mergeCells('A1', 'G1');
      ws.getCell('A1').value = `Detalle del día – ${title}`;
      ws.getCell('A1').font = { bold: true, size: 13 };

      if (det?.__error) {
        ws.addRow([]);
        ws.addRow(['No se pudo calcular el detalle para este día:', String(det.__error.message || det.__error)]);
        continue;
      }

      const emerVeces = Number(det?.emergencias?.veces || 0);
      const emerMin = Number(det?.emergencias?.minutos || 0);
      const contDia = Number(det?.contadorDiaTicks || 0);
      const firstOn = det?.run?.firstOn ? new Date(det.run.firstOn) : null;
      const lastOff = det?.run?.lastOff ? new Date(det.run.lastOff) : null;
      const totalRunM = Number(det?.run?.totalRunMin || 0);
      const avgH = Number(det?.averages?.avgPerHour || 0);
      const avgM = Number(det?.averages?.avgPerMin || 0);

      const fmtHM = (d) => d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '—';
      const fmtHmin = (m) => {
        const h = Math.floor((m || 0) / 60), mm = (m || 0) % 60;
        return h ? `${h} h ${mm} min` : `${mm} min`;
      };

      ws.addRow([]);
      ws.addRow(['Emergencias (veces)', emerVeces, '', 'Tiempo en emergencia', fmtHmin(emerMin), '', 'Contador del día', contDia]);
      ws.addRow(['Inicios producción', fmtHM(firstOn), '', 'Fin producción', fmtHM(lastOff), '', 'Total producción', fmtHmin(totalRunM)]);
      ws.addRow(['Promedio (cajas/h)', avgH, '', 'Promedio (cajas/min)', avgM, '', '', '']);

      ws.getRow(ws.lastRow.number - 2).getCell(8).numFmt = '#,##0';
      ws.getRow(ws.lastRow.number - 3).getCell(8).numFmt = '#,##0';
      ws.getRow(ws.lastRow.number - 2).getCell(2).numFmt = '#,##0';
      ws.getRow(ws.lastRow.number - 1).getCell(2).numFmt = '#,##0';
      ws.getRow(ws.lastRow.number - 1).getCell(5).numFmt = '#,##0.0';

      ws.addRow([]);
      const hdrRow2 = ws.addRow([
        'Desde', 'Hasta', 'Emergencia (min)', 'Duración Producción (min)',
        'Cantidad de Emergencias', 'Producción Total', 'Promedio (cajas/min)'
      ]);
      hdrRow2.font = { bold: true };
      ws.columns = [
        { width: 12 }, { width: 12 }, { width: 20, style: { numFmt: '#,##0' } },
        { width: 24, style: { numFmt: '#,##0' } }, { width: 24, style: { numFmt: '#,##0' } },
        { width: 18, style: { numFmt: '#,##0' } }, { width: 24, style: { numFmt: '#,##0.0' } }
      ];

      const intervals = det?.run?.intervals || [];
      let sumEmerMin = 0, sumDur = 0, sumEmerCnt = 0, sumProd = 0;
      for (const it of intervals) {
        const d1 = it?.start ? new Date(it.start) : null;
        const d2 = it?.end ? new Date(it.end) : null;
        const emerM = Number(it?.emerMin || 0);
        const durM = Number(it?.durationMin || 0);
        const cntE = Number(it?.emerCount || 0);
        const prod = Number(it?.producedTicks || 0);
        const avg = durM > 0 ? Math.round((prod / durM) * 10) / 10 : 0;
        sumEmerMin += emerM;
        sumDur += durM;
        sumEmerCnt += cntE;
        sumProd += prod;
        ws.addRow([fmtHM(d1), fmtHM(d2), emerM, durM, cntE, prod, avg]);
      }

      const avgTotal = sumDur > 0 ? Math.round((sumProd / sumDur) * 10) / 10 : 0;
      const tot = ws.addRow(['Total', '', sumEmerMin, sumDur, sumEmerCnt, sumProd, avgTotal]);
      tot.font = { bold: true };

      const startTableRow = hdrRow2.number;
      const endTableRow = ws.lastRow.number;
      for (let r = startTableRow; r <= endTableRow; r++) {
        for (let c = 1; c <= 7; c++) {
          ws.getCell(r, c).border = {
            top: { style: 'thin', color: { argb: 'FFD0D7E2' } },
            left: { style: 'thin', color: { argb: 'FFD0D7E2' } },
            bottom: { style: 'thin', color: { argb: 'FFD0D7E2' } },
            right: { style: 'thin', color: { argb: 'FFD0D7E2' } }
          };
        }
      }

      // Imagen de tendencia por hora (dinámico)
      try {
        const lbls = (det?.bins1h || []).map(b => b.label);
        const cumul = (det?.bins1h || []).map(b => b.cumulative ?? 0);
        const imgBuf = await makeTrendImage({ labels: lbls, cumulative: cumul, width: 1000, height: 320 });
        if (imgBuf) {
          const imgId = wb.addImage({ buffer: imgBuf, extension: 'png' });
          const startRow = ws.lastRow.number + 2;
          ws.addImage(imgId, { tl: { col: 0, row: startRow }, ext: { width: 1000, height: 320 } });
        }
      } catch { }
    }

    const fileBase = `historicos_${safeName}_${String(startISO).slice(0, 10)}_a_${String(endISO).slice(0, 10)}.xlsx`;
    const fullExports = path.join(EXPORT_DIR, fileBase);

    await wb.xlsx.writeFile(fullExports);
    res.json({ ok: true, file: `/api/exports/file/${encodeURIComponent(fileBase)}`, filename: fileBase });
  } catch (e) {
    console.error('[history/export]', e);
    res.status(500).json({ ok: false, message: e.message || 'No se pudo generar el Excel' });
  }
});

/* ===== Export Excel GENERAL (con gráficos por mes por máquina) ===== */
router.post('/exportGeneral', async (req, res) => {
  try {
    const startISO = norm(req.body.start);
    const endISO = norm(req.body.end);
    const machines = Array.isArray(req.body.machines) ? req.body.machines : [];

    if (!startISO || !endISO) {
      return res.status(400).json({ ok: false, message: 'start y end requeridos' });
    }

    await fs.promises.mkdir(EXPORT_DIR, { recursive: true });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CSF';
    wb.created = new Date();

    let list = machines;
    if (!list.length) {
      try {
        const client = await getClient(req);
        const boxes = await client.getBoxes().catch(() => null);
        const groups = boxes?.result?.list || boxes?.list || [];
        const flat = [];
        for (const g of groups) for (const b of (g.boxList || [])) {
          flat.push({ boxId: String(b.boxId), name: b.boxName || String(b.boxId) });
        }
        list = flat;
      } catch { }
    }

    if (!list.length) {
      return res.status(404).json({ ok: false, message: 'No hay máquinas para exportar' });
    }

    for (const m of list) {
      const boxId = String(m.boxId);
      const mName = norm(m.name) || boxId;
      const safeName = sanitizeFilename(mName).slice(0, 28);

      const seriesResp = await buildSeriesForRange(req, { boxId, startISO, endISO, nameQ: mName });
      const perDay = seriesResp.series?.[0]?.data || [];
      const days = listDaysISO(startISO, endISO);
      const perDayCum = [];
      let acc = 0;
      for (let i = 0; i < perDay.length; i++) {
        acc += Number(perDay[i]) || 0;
        perDayCum.push(acc);
      }

      const ws = wb.addWorksheet(safeName || 'Maquina');
      ws.properties.defaultRowHeight = 18;
      ws.mergeCells('A1', 'D1');
      ws.getCell('A1').value = `Históricos – ${mName} (${startISO} a ${endISO})`;
      ws.getCell('A1').font = { bold: true, size: 14 };
      ws.getCell('A1').alignment = { vertical: 'middle' };
      ws.addRow([]);

      const header = ['Fecha', 'Producido (día)', 'Acumulado', 'Detalle'];
      const hdr = ws.addRow(header);
      hdr.font = { bold: true };
      ws.getColumn(1).width = 14;
      ws.getColumn(2).width = 18;
      ws.getColumn(3).width = 14;
      ws.getColumn(4).width = 28;

      for (let i = 0; i < days.length; i++) {
        const day = days[i];
        const val = Number(perDay[i] || 0);
        const acum = Number(perDayCum[i] || 0);
        const detSheetName = sanitizeFilename(`Detalle - ${safeName} - ${day}`).slice(0, 31);
        const r = ws.addRow([day, val, acum, `Ver detalle ▶ ${day}`]);
        const linkCell = ws.getCell(`D${r.number}`);
        linkCell.font = { color: { argb: 'FF1E90FF' }, underline: true };
        linkCell.value = { text: `Ver detalle ▶ ${day}`, hyperlink: `#'${detSheetName}'!A1` };
        r.getCell(2).numFmt = '#,##0';
        r.getCell(3).numFmt = '#,##0';
      }

      // === Gráficos por mes ===
      try {
        ws.addRow([]);
        const titleRow = ws.addRow(['Gráficos por mes']);
        titleRow.font = { bold: true, size: 12 };
        const monthly = splitMonthlyGroups(days, perDay);
        let cursorRow = ws.lastRow.number + 2;
        const G_WIDTH = 1000, G_HEIGHT = 380;
        for (const g of monthly) {
          ws.getCell(cursorRow, 1).value = g.title;
          ws.getCell(cursorRow, 1).font = { bold: true };
          cursorRow += 1;
          const imgBuf = await makeBarLineImage({ labels: g.labels, bars: g.bars, line: g.line, width: G_WIDTH, height: G_HEIGHT });
          if (imgBuf) {
            const imgId = wb.addImage({ buffer: imgBuf, extension: 'png' });
            cursorRow = placeImageBelow(ws, imgId, cursorRow, { width: G_WIDTH, height: G_HEIGHT }, 0, 2);
          } else {
            cursorRow += 2;
          }
          cursorRow += 1;
        }
      } catch { }

      // ===== Hojas de detalle por día =====
      for (let i = 0; i < days.length; i++) {
        const day = days[i];
        const detSheetName = sanitizeFilename(`Detalle - ${safeName} - ${day}`).slice(0, 31);
        const wsD = wb.addWorksheet(detSheetName);
        wsD.properties.defaultRowHeight = 18;
        const det = await getOrComputeDayDetail(req, boxId, day).catch(() => null);

        wsD.mergeCells('A1', 'C1');
        wsD.getCell('A1').value = `Detalle – ${mName} – ${day}`;
        wsD.getCell('A1').font = { bold: true, size: 13 };

        const labels = (det?.bins1h || []).map(b => b.label || '');
        const hourly = (det?.bins1h || []).map(b => Math.max(0, Number(b.produced || b.producedTicks || 0)));
        const cumulative = [];
        let accH = 0;
        for (const v of hourly) {
          accH += v;
          cumulative.push(accH);
        }

        wsD.addRow([]);
        const hdr = wsD.addRow(['Hora', 'Producido', 'Acumulado']);
        hdr.font = { bold: true };
        wsD.getColumn(1).width = 10;
        wsD.getColumn(2).width = 12;
        wsD.getColumn(3).width = 12;

        for (let k = 0; k < labels.length; k++) {
          const rr = wsD.addRow([labels[k], hourly[k] || 0, cumulative[k] || 0]);
          rr.getCell(2).numFmt = '#,##0';
          rr.getCell(3).numFmt = '#,##0';
        }

        try {
          const imgBuf = await makeTrendImage({ labels, cumulative, width: 1000, height: 320 });
          if (imgBuf) {
            const imgId = wb.addImage({ buffer: imgBuf, extension: 'png' });
            let cursorRow = wsD.lastRow.number + 2;
            cursorRow = placeImageBelow(wsD, imgId, cursorRow, { width: 1000, height: 320 }, 0, 1);
          }
        } catch { }

        wsD.addRow([]);
        const linkCell = wsD.addRow([`Volver a ${safeName}`]).getCell(1);
        linkCell.font = { color: { argb: 'FF1E90FF' }, underline: true };
        linkCell.value = { text: `Volver a ${safeName}`, hyperlink: `#'${safeName}'!A1` };
      }
    }

    const fileBase = `historicos_general_${String(startISO).slice(0, 10)}_a_${String(endISO).slice(0, 10)}.xlsx`;
    const fullExports = path.join(EXPORT_DIR, fileBase);

    await wb.xlsx.writeFile(fullExports);
    res.json({ ok: true, file: `/api/exports/file/${encodeURIComponent(fileBase)}`, filename: fileBase });
  } catch (e) {
    console.error('[history/exportGeneral]', e);
    res.status(500).json({ ok: false, message: e.message || 'No se pudo generar el Excel general' });
  }
});

// ===== /meta =====
router.get('/meta', async (_req, res) => {
  try {
    const list = await getCollection('machines').find({})
      .project({ _id: 0, machineName: 1, boxId: 1, initialCounter: 1, company: 1, provider: 1, startDate: 1 })
      .toArray();
    res.json({ list: list || [] });
  } catch (e) {
    console.error('[history/meta]', e);
    res.json({ list: [] });
  }
});

module.exports = router;