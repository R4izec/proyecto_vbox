'use strict';

/* ================== Menú / Logout ================== */
const menuBtn = document.getElementById('menuBtn');
const menu = document.getElementById('userMenu');
const logoutBtn = document.getElementById('logoutBtn');

function toggleMenu(open) {
  const isOpen = typeof open === 'boolean' ? open : !menu?.classList.contains('open');
  menu?.classList.toggle('open', isOpen);
  menuBtn?.setAttribute('aria-expanded', String(isOpen));
}

menuBtn?.addEventListener('click', () => toggleMenu());
document.addEventListener('click', (e) => {
  if (!menu || !menuBtn) return;
  if (menu.contains(e.target) || menuBtn.contains(e.target)) return;
  toggleMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleMenu(false);
});

let logoutModal;
function ensureLogoutModal() {
  if (logoutModal) return logoutModal;
  const overlay = document.querySelector('.modal[data-kind="logout"]') || (() => {
    const el = document.createElement('div');
    el.className = 'modal';
    el.dataset.kind = 'logout';
    document.body.appendChild(el);
    return el;
  })();
  overlay.innerHTML = `<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="logoutTitle">
    <h3 id="logoutTitle">¿Cerrar sesión?</h3>
    <p>Se cerrará tu sesión actual. Puedes cancelar para seguir en la página.</p>
    <div class="modal-buttons">
      <button type="button" class="cancel">Cancelar</button>
      <button type="button" class="danger confirm">Cerrar sesión</button>
    </div>
  </div>`;
  const open = () => {
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  const close = () => {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  };
  overlay.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', e => {
    if (overlay.classList.contains('open') && e.key === 'Escape') close();
  });
  overlay.querySelector('.cancel').addEventListener('click', close);
  overlay.querySelector('.confirm').addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch { }
    try {
      localStorage.removeItem('vbox_sid');
    } catch { }
    location.replace('/login');
  });
  logoutModal = { open, close, el: overlay };
  return logoutModal;
}

logoutBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  toggleMenu(false);
  ensureLogoutModal().open();
});

/* ================== Sesión ================== */
async function ensureLogged() {
  try {
    const r = await fetch('/api/me', { credentials: 'include' });
    if (!r.ok) throw new Error();
    const { user } = await r.json();
    sessionStorage.setItem('user', JSON.stringify(user));
    return user;
  } catch {
    location.href = '/login';
    throw new Error('No session');
  }
}

/* ================== API helper ================== */
const sid = localStorage.getItem('vbox_sid');
async function api(path, params = {}, fetchOpts = {}) {
  const url = new URL(path, location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const resp = await fetch(url.pathname + url.search, {
    credentials: 'include',
    headers: { 'x-vbox-sid': sid || '' },
    ...fetchOpts
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) location.href = '/login';
    throw new Error(json?.message || `Error API ${resp.status}`);
  }
  return json;
}

async function apiPost(path, body = {}) {
  const resp = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'x-vbox-sid': sid || ''
    },
    body: JSON.stringify(body)
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) location.href = '/login';
    throw new Error(json?.message || `Error API ${resp.status}`);
  }
  return json;
}

/* --- Caché persistente (localStorage) --- */
const CACHE_PREFIX = 'hist_cache_';
function getDatoCacheado(key) {
  try {
    const it = localStorage.getItem(CACHE_PREFIX + key);
    return it ? JSON.parse(it) : null;
  } catch (e) {
    console.error(e);
    return null;
  }
}

function setDatoCacheado(key, payload) {
  try {
    if (!payload) return;
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(payload));
  } catch (e) {
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
      });
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(payload));
    } catch (e2) {
      console.error('cache', e2);
    }
  }
}

function limpiarDatoCacheado(key) {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch (e) { }
}

/* ================== Controles / filtros ================== */
const machineSearch = document.getElementById('machineSearch');
const machineSelect = document.getElementById('machineSelect');
const companySelect = document.getElementById('companySelect');
const providerSelect = document.getElementById('providerSelect');
const startDate = document.getElementById('startDate');
const endDate = document.getElementById('endDate');
const btnToday = document.getElementById('btnToday');
const btn7 = document.getElementById('btn7');
const btn30 = document.getElementById('btn30');
const btnSearch = document.getElementById('btnSearch');
const btnExport = document.getElementById('btnExport');
const btnExportAll = document.getElementById('btnExportAll');
const btnRefresh = document.getElementById('btnRefresh');

const toInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fromInputLocal = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};
const toISODateLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function sanitizeFilename(s = '') {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '').replace(/\s+/g, ' ').trim().replace(/\s/g, '_');
}

function makeReportFilename(machineName, startISO, endISO) {
  const base = sanitizeFilename(machineName || 'Maquina');
  const a = String(startISO || '').slice(0, 10);
  const b = String(endISO || '').slice(0, 10);
  return `historicos_${base}_${a}_a_${b}.xlsx`;
}

function buildDaysArray(startStr, endStr) {
  const ini = fromInputLocal(startStr);
  const fin = fromInputLocal(endStr);
  const days = [];
  for (let d = new Date(ini); d.getTime() <= fin.getTime(); d.setDate(d.getDate() + 1)) {
    days.push(toISODateLocal(d));
  }
  return days;
}

function setRange(days) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  if (startDate) startDate.value = toInput(start);
  if (endDate) endDate.value = toInput(end);
}

btnToday?.addEventListener('click', () => setRange(1));
btn7?.addEventListener('click', () => setRange(7));
btn30?.addEventListener('click', () => setRange(30));

/* ================== Máquinas ================== */
function flattenBoxList(data) {
  const groups = data?.result?.list || data?.list || [];
  const rows = [];
  for (const g of groups) for (const b of (g.boxList || [])) rows.push(b);
  return rows;
}

let allBoxes = [];
function uniqSorted(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
}

function extractMFNumber(nameOrId) {
  const s = String(nameOrId || '');
  const m = s.match(/MF[-\s]?(\d+)/i) || s.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function applyCompanyProviderOptions() {
  const companies = uniqSorted(allBoxes.map(b => b.company));
  const providers = uniqSorted(allBoxes.map(b => b.provider));
  companySelect.innerHTML = `<option value="" selected>Selecciona</option>` +
    companies.map(c => `<option value="${c}">${c}</option>`).join('');
  providerSelect.innerHTML = `<option value="" selected>Selecciona</option>` +
    providers.map(p => `<option value="${p}">${p}</option>`).join('');
}

function rebuildMachineOptions() {
  const q = (machineSearch?.value || '').trim().toLowerCase();
  const company = companySelect?.value || '';
  const provider = providerSelect?.value || '';
  const filtered = allBoxes.filter(b => {
    const name = (b.boxName || b.boxId || '').toLowerCase();
    const idn = String(b.boxId || '').replace(/\D/g, '');
    const okQ = !q || name.includes(q) || (idn && idn.includes(q.replace(/\D/g, '')));
    const okC = !company || String(b.company || '') === company;
    const okP = !provider || String(b.provider || '') === provider;
    return okQ && okC && okP;
  });
  filtered.sort((a, b) => {
    const na = extractMFNumber(a.boxName || a.boxId);
    const nb = extractMFNumber(b.boxName || b.boxId);
    if (na != null && nb != null) return nb - na;
    if (na != null) return -1;
    if (nb != null) return 1;
    return String(a.boxName || a.boxId).localeCompare(String(b.boxName || b.boxId), 'es');
  });
  machineSelect.innerHTML = filtered.map(b =>
    `<option value="${b.boxId}" data-company="${b.company || ''}" data-provider="${b.provider || ''}">${b.boxName || b.boxId}</option>`
  ).join('');
  if (filtered.length) machineSelect.value = filtered[0].boxId;
}

async function loadMachines() {
  const [boxesData, meta] = await Promise.all([
    api('/api/monitor/boxes'),
    api('/api/history/meta').catch(() => ({ list: [] }))
  ]);
  const base = flattenBoxList(boxesData);
  const byName = new Map((meta?.list || []).map(m => [String(m.machineName || '').toLowerCase(), m]));
  const byId = new Map((meta?.list || []).map(m => [String(m.boxId || '').toLowerCase(), m]));
  allBoxes = base.map(b => {
    const m = byName.get(String(b.boxName || '').toLowerCase()) || byId.get(String(b.boxId || '').toLowerCase()) || {};
    return {
      boxId: b.boxId,
      boxName: b.boxName || b.boxId,
      company: m.company || '',
      provider: m.provider || '',
      initialCounter: Number(m.initialCounter || 0),
      startDate: m.startDate || null
    };
  });
  applyCompanyProviderOptions();
  rebuildMachineOptions();
}

machineSearch?.addEventListener('input', rebuildMachineOptions);
companySelect?.addEventListener('change', rebuildMachineOptions);
providerSelect?.addEventListener('change', rebuildMachineOptions);

/* ================== KPIs ================== */
const nf = new Intl.NumberFormat('es-CL');
const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const kCurrent = document.getElementById('k-current');
const kTotal = document.getElementById('k-total');
const kRange = document.getElementById('k-range');
const hisLoader = document.getElementById('hisLoader');
const hisEmpty = document.getElementById('hisEmpty');
const hisError = document.getElementById('hisError');

/* ================== Multi-mes: gráficos ================== */
const chartsWrap = document.getElementById('hisChartsWrap');
let monthCharts = [];

const valueLabels = {
  id: 'values',
  afterDatasetsDraw(c) {
    const { ctx } = c;
    const barsMeta = c.getDatasetMeta(0);
    const lineMeta = c.getDatasetMeta(1);
    ctx.save();
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const bars = c.data.datasets?.[0]?.data || [];
    if (barsMeta?.data?.length) {
      ctx.fillStyle = '#dce3ee';
      bars.forEach((v, i) => {
        if (!(typeof v === 'number')) return;
        const p = barsMeta.data[i];
        if (!p) return;
        const { x, y } = p.tooltipPosition();
        ctx.fillText(nf.format(v), x, y - 6);
      });
    }
    const line = c.data.datasets?.[1]?.data || [];
    if (lineMeta?.data?.length) {
      line.forEach((v, i) => {
        if (!(typeof v === 'number')) return;
        const p = lineMeta.data[i];
        if (!p) return;
        const { x, y } = p.tooltipPosition();
        const txt = nf.format(v);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.55)';
        ctx.strokeText(txt, x, y - 10);
        ctx.fillStyle = '#e6eef8';
        ctx.fillText(txt, x, y - 10);
      });
    }
    ctx.restore();
  }
};

function clearMonthCharts() {
  monthCharts.forEach(ch => {
    try {
      ch?.destroy();
    } catch { }
  });
  monthCharts = [];
  if (chartsWrap) chartsWrap.innerHTML = '';
}

function renderMonthlyCharts(daysISO, perDay) {
  if (!chartsWrap) return;
  const buckets = new Map();
  for (let i = 0; i < daysISO.length; i++) {
    const iso = daysISO[i];
    const key = iso.slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, { daysISO: [], vals: [] });
    buckets.get(key).daysISO.push(iso);
    buckets.get(key).vals.push(Number(perDay[i]) || 0);
  }
  const today = new Date();
  const curKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const keys = [...buckets.keys()].sort().reverse();
  const ordered = [];
  if (buckets.has(curKey)) ordered.push(curKey);
  for (const k of keys) {
    if (k !== curKey) ordered.push(k);
  }
  ordered.forEach((key) => {
    const { daysISO: dArr, vals: vArr } = buckets.get(key);
    const labels = dArr.map(iso => {
      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      const dd = String(dt.getDate()).padStart(2, '0');
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dow = dt.toLocaleDateString('es-CL', { weekday: 'short' });
      return `${dow}, ${dd}-${mm}`;
    });
    const accum = [];
    let acc = 0;
    for (const v of vArr) {
      acc += Number(v) || 0;
      accum.push(acc);
    }
    const [yy, mm] = key.split('-').map(Number);
    const monthTitle = new Date(yy, mm - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
    const card = document.createElement('div');
    card.className = 'his-month-card';
    card.innerHTML = `<div class="his-month-head">
      <h3 class="his-month-title">${monthTitle[0].toUpperCase() + monthTitle.slice(1)}</h3>
      <div class="his-month-meta">${dArr[0]} → ${dArr[dArr.length - 1]}</div>
    </div>
    <div class="his-month-canvas">
      <canvas></canvas>
    </div>`;
    chartsWrap.appendChild(card);
    const canvas = card.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const ch = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Contador del día (General)',
            data: vArr,
            backgroundColor: 'rgba(0,102,254,.62)',
            order: 1
          },
          {
            type: 'line',
            label: 'Acumulado',
            data: accum,
            borderWidth: 2,
            tension: 0.25,
            pointRadius: 3,
            pointHoverRadius: 5,
            borderColor: '#00d5ff',
            backgroundColor: 'transparent',
            order: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, labels: { color: '#cbd5e1' } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${(ctx.dataset.label || '')}: ${nf.format(Number(ctx.parsed.y || 0))}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#9aa3b2' } },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,.08)' },
            ticks: { color: '#9aa3b2', callback: (v) => nf.format(v) }
          }
        },
        onClick: (evt) => {
          try {
            const els = ch.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
            const i = els?.[0]?.index;
            const dayISO = (i != null) ? dArr[i] : null;
            if (dayISO) openDayPanel(dayISO);
          } catch (e) {
            console.error('onClick monthly chart error:', e);
          }
        }
      },
      plugins: [valueLabels]
    });
    monthCharts.push(ch);
  });
}

(function injectMonthlyStyles() {
  const css = `.his-months-wrap{display:flex;flex-direction:column;gap:16px;}
    .his-month-card{background: var(--card, rgba(18,22,29,.7));border: 1px solid var(--stroke, rgba(255,255,255,.08));border-radius: var(--radius, 18px);box-shadow: var(--shadow, 0 10px 30px rgba(0,0,0,.35));padding: 12px;}
    .his-month-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:8px;}
    .his-month-title{margin:0;font-size:16px;line-height:1.2;color: var(--txt, #e6eaf2);}
    .his-month-meta{font-size:12px;color: var(--muted, #9aa3b2);}
    .his-month-canvas{height: 320px;}
    @media (max-width: 1200px){.his-month-canvas{ height: 260px; }}`;
  const tag = document.createElement('style');
  tag.setAttribute('data-from', 'historicos-months');
  tag.textContent = css;
  document.head.appendChild(tag);
})();

/* ================== Buscar datos ================== */
const kCurrentEl = kCurrent, kTotalEl = kTotal, kRangeEl = kRange;
let lastSearchAbort;

async function fetchRealtimeGeneralCounter(boxId, signal) {
  try {
    if (!boxId) return null;
    const r = await api('/api/monitor/realtime', { boxId, tag: 'CONTADOR GENERAL' }, { signal });
    const cur = Number(String((r?.contador ?? r?.general ?? r?.value ?? '')).replace(',', '.'));
    return Number.isFinite(cur) ? cur : null;
  } catch {
    return null;
  }
}

function padArrayTo(arr, len, pad = 0) {
  const out = arr.slice(0);
  while (out.length < len) out.push(pad);
  if (out.length > len) out.length = len;
  return out;
}

async function doSearch() {
  if (lastSearchAbort) lastSearchAbort.abort();
  lastSearchAbort = new AbortController();
  hisError.style.display = 'none';
  hisEmpty.style.display = 'none';
  hisLoader.style.display = 'flex';
  clearMonthCharts();

  try {
    const boxId = machineSelect?.value;
    const start = startDate?.value;
    const end = endDate?.value;

    if (!boxId || !start || !end) {
      console.warn('Búsqueda detenida. Faltan datos:', { boxId, start, end });
      hisLoader.style.display = 'none';
      hisEmpty.style.display = 'block';
      return;
    }

    const machineName = machineSelect?.selectedOptions?.[0]?.textContent || '';
    const signal = lastSearchAbort.signal;
    const todayISO = toISODateLocal(new Date());
    const rangeIncludesToday = (todayISO >= start && todayISO <= end);
    const seriesCacheKey = `series_${boxId}_${start}_${end}`;

    let series = null;
    if (!rangeIncludesToday) {
      series = getDatoCacheado(seriesCacheKey);
    }

    if (!series) {
      series = await api('/api/history/series', { boxId, start, end, name: machineName }, { signal });
      if (series && !rangeIncludesToday) setDatoCacheado(seriesCacheKey, series);
    }

    const daysISO = buildDaysArray(start, end);
    const generalDs = Array.isArray(series?.series) ? series.series[0] : null;
    const perDayRaw = Array.isArray(generalDs?.data) ? generalDs.data : [];
    const perDay = padArrayTo(perDayRaw, daysISO.length, 0);

    const perDayCum = [];
    let acc = 0;
    for (let i = 0; i < daysISO.length; i++) {
      acc += Number(perDay[i]) || 0;
      perDayCum.push(acc);
    }

    const currentCounter = await fetchRealtimeGeneralCounter(boxId, lastSearchAbort.signal);
    const initialCounter = Number(series?.initialCounter || 0);
    const sumRange = perDay.reduce((a, b) => a + (Number(b) || 0), 0);
    const totalProd = (currentCounter == null) ? null : Math.max(0, Math.round(currentCounter - initialCounter));

    kCurrentEl.textContent = (currentCounter == null) ? '—' : nf.format(currentCounter);
    kTotalEl.textContent = (totalProd == null) ? '—' : nf.format(totalProd);
    kRangeEl.textContent = nf.format(sumRange || 0);

    renderMonthlyCharts(daysISO, perDay);
    hisLoader.style.display = 'none';
    if (!perDay.length) hisEmpty.style.display = 'block';
  } catch (e) {
    if (e?.name === 'AbortError') return;
    console.error(e);
    hisLoader.style.display = 'none';
    hisError.style.display = 'block';
    hisError.textContent = e.message || 'Error al cargar históricos';
    kCurrentEl.textContent = '—';
    kTotalEl.textContent = '—';
    kRangeEl.textContent = '—';
  }
}

btnSearch?.addEventListener('click', () => doSearch());
btnRefresh?.addEventListener('click', () => {
  const boxId = machineSelect?.value;
  const start = startDate?.value;
  const end = endDate?.value;
  if (!boxId || !start || !end) return doSearch();
  const seriesCacheKey = `series_${boxId}_${start}_${end}`;
  limpiarDatoCacheado(seriesCacheKey);
  const daysISO = buildDaysArray(start, end);
  daysISO.forEach(dayISO => limpiarDatoCacheado(`detail_${boxId}_${dayISO}`));
  doSearch();
});

/* ================== Side Panel ================== */
const dpEl = document.getElementById('dpanel');
const dpCloseBg = document.getElementById('dp-close');
const dpCloseBtn = document.getElementById('dp-x');
const dpSub = document.getElementById('dp-sub');
const dpKpiEmer = document.getElementById('dp-kpi-emer');
const dpKpiEmerM = document.getElementById('dp-kpi-emermin');
const dpKpiCont = document.getElementById('dp-kpi-cont');
const dpFirstOn = document.getElementById('dp-firstOn');
const dpLastOff = document.getElementById('dp-lastOff');
const dpRunTotal = document.getElementById('dp-runTotal');
const dpRows = document.getElementById('dp-rows');
const dpFoot = document.getElementById('dp-foot');

let dpChart;
let dpBusy = false;
let dpOpen = false;
const dpMain = document.getElementById('dp-main');
const btnToggleTable = document.getElementById('btnToggleTable');

const dpValueLabels = {
  id: 'dpValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    const hourly = chart.data._hourly || [];
    ctx.save();
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e6eef8';
    hourly.forEach((v, i) => {
      if (!(typeof v === 'number')) return;
      const p = meta.data?.[i];
      if (!p) return;
      const { x, y } = p.tooltipPosition();
      const txt = nf.format(v);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.55)';
      ctx.strokeText(txt, x, y - 10);
      ctx.fillText(txt, x, y - 10);
    });
    ctx.restore();
  }
};

function ensureDpChart() {
  const canvas = document.getElementById('dpChart');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (dpChart) {
    dpChart.destroy();
    dpChart = null;
  }
  dpChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Acumulado horario',
        data: [],
        borderWidth: 2,
        borderColor: '#00d5ff',
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: false,
        tension: 0.35,
        stepped: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const acum = nf.format(ctx.parsed.y || 0);
              const hora = ctx.chart.data.labels?.[ctx.dataIndex] || '';
              const prod = nf.format(ctx.chart.data._hourly?.[ctx.dataIndex] || 0);
              return `${hora}: ${prod} (acum: ${acum})`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9aa3b2' } },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255,255,255,.08)' },
          ticks: { color: '#9aa3b2', callback: (v) => nf.format(v) }
        }
      }
    },
    plugins: [dpValueLabels]
  });
  return dpChart;
}

function openPanelInstant() {
  if (!dpEl || dpOpen) return;
  dpOpen = true;
  dpEl.classList.add('open');
  dpEl.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => {
    dpEl.classList.add('show');
  });
  document.body.style.overflow = 'hidden';
  compactDpHeader();
}

function closePanel() {
  if (!dpEl || !dpOpen) return;
  dpEl.classList.remove('show');
  const onEnd = (e) => {
    if (e.target !== dpEl.querySelector('.dpanel-body')) return;
    dpEl.removeEventListener('transitionend', onEnd);
    dpEl.classList.remove('open');
    dpEl.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    dpOpen = false;
  };
  setTimeout(() => {
    if (dpOpen) onEnd({ target: dpEl.querySelector('.dpanel-body') });
  }, 350);
  dpEl.addEventListener('transitionend', onEnd);
}

dpCloseBg?.addEventListener('click', closePanel);
dpCloseBtn?.addEventListener('click', closePanel);
btnToggleTable?.addEventListener('click', () => {
  if (!dpMain) return;
  const isHidden = dpMain.style.display === 'none';
  if (isHidden) {
    dpMain.style.display = 'flex';
    btnToggleTable.textContent = 'Ocultar detalles';
  } else {
    dpMain.style.display = 'none';
    btnToggleTable.textContent = 'Mostrar detalles';
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dpOpen) closePanel();
});

function fmtHM(ms) {
  if (!ms && ms !== 0) return '—';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function setPanelLoading(dayISO) {
  const dObj = new Date(dayISO + 'T00:00:00');
  dpSub.textContent = dObj.toLocaleDateString('es-CL', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
  dpKpiEmer.textContent = '—';
  dpKpiEmerM.textContent = '—';
  dpKpiCont.textContent = '—';
  dpFirstOn.textContent = '—';
  dpLastOff.textContent = '—';
  dpRunTotal.textContent = '—';
  dpRows.innerHTML = `<tr class="dp-loading">
    <td colspan="7">
      <div class="dp-spinner"></div>
      <div class="dp-loading-text">Cargando detalle…</div>
    </td>
  </tr>`;
  dpFoot.innerHTML = `<tr><td colspan="7" class="muted">—</td></tr>`;
  if (dpMain) dpMain.style.display = 'none';
  if (btnToggleTable) btnToggleTable.textContent = 'Mostrar detalles';
  const ch = ensureDpChart();
  if (ch) {
    ch.data.labels = [];
    ch.data.datasets[0].data = [];
    ch.data._hourly = [];
    ch.update();
  }
}

/* ====== Tabla del panel ====== */
function renderDpTableFromIntervals(intervals) {
  dpRows.innerHTML = '';
  const rows = (intervals || []).slice().sort((a, b) => a.start - b.start);
  if (!rows.length) {
    dpRows.innerHTML = `<tr><td colspan="7" class="muted">Sin intervalos de producción</td></tr>`;
    dpFoot.innerHTML = `<tr><td colspan="7" class="muted">—</td></tr>`;
    const chipH = document.getElementById('chip-cph');
    const chipM = document.getElementById('chip-cpm');
    if (chipH) chipH.textContent = '—/h';
    if (chipM) chipM.textContent = '—/min';
    return;
  }

  let sumDur = 0, sumProd = 0, sumEmerMin = 0, sumEmerCnt = 0;
  for (const it of rows) {
    const dur = Number(it.durationMin || 0);
    const prod = Math.max(0, Number(it.producedTicks || it.produced || 0));
    const emerMin = Math.max(0, Number(it.emerMin || 0));
    const emerCnt = Math.max(0, Number(it.emerCount || 0));
    const avg = dur > 0 ? (prod / dur) : 0;
    sumDur += dur;
    sumProd += prod;
    sumEmerMin += emerMin;
    sumEmerCnt += emerCnt;

    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="center">${fmtHM(it.start)}</td>
      <td class="center">${fmtHM(it.end)}</td>
      <td class="num">${nf0.format(emerMin)}</td>
      <td class="num">${nf0.format(dur)}</td>
      <td class="num">${nf0.format(emerCnt)}</td>
      <td class="num">${nf0.format(prod)}</td>
      <td class="num">${nf1.format(Math.round((avg) * 10) / 10)}</td>`;
    dpRows.appendChild(tr);
  }

  const avgTotal = sumDur > 0 ? (sumProd / sumDur) : 0;
  dpFoot.innerHTML = `<tr>
    <td><strong>Total</strong></td>
    <td></td>
    <td class="num"><strong>${nf0.format(sumEmerMin)}</strong></td>
    <td class="num"><strong>${nf0.format(sumDur)}</strong></td>
    <td class="num"><strong>${nf0.format(sumEmerCnt)}</strong></td>
    <td class="num"><strong>${nf0.format(sumProd)}</strong></td>
    <td class="num"><strong>${nf1.format(Math.round(avgTotal * 10) / 10)}</strong></td>
  </tr>`;

  const chipH = document.getElementById('chip-cph');
  const chipM = document.getElementById('chip-cpm');
  if (chipH) chipH.textContent = `${nf0.format(Math.round(avgTotal * 60))}/h`;
  if (chipM) chipM.textContent = `${nf1.format(Math.round(avgTotal * 10) / 10)}/min`;
}

function compactDpHeader() {
  const thead = document.querySelector('.dpanel thead');
  if (!thead) return;
  const ths = Array.from(thead.querySelectorAll('th'));
  if (ths.length < 7) return;
  const full = ['Desde', 'Hasta', 'Tiempo en emergencia (min)', 'Duración de Producción (min)', 'Cantidad de Emergencias', 'Producción Total', 'Promedio (cajas/min)'];
  const short = ['Desde', 'Hasta', 'Emerg. (min)', 'Prod (min)', '# Emerg.', 'Prod. total', 'Prom. (c/min)'];
  ths.forEach((th, i) => {
    th.title = full[i] || th.textContent;
    th.textContent = short[i] || th.textContent;
  });
}

async function openDayPanel(dayISO) {
  const boxId = machineSelect?.value;
  if (!boxId || !dayISO) return;
  if (dpBusy) return;
  dpBusy = true;

  try {
    setPanelLoading(dayISO);
    openPanelInstant();

    const isToday = (dayISO === toISODateLocal(new Date()));
    const detailCacheKey = `detail_${boxId}_${dayISO}`;

    let d = null;
    if (!isToday) d = getDatoCacheado(detailCacheKey);

    if (!d) {
      d = await api('/api/history/daydetail', { boxId, day: dayISO });
      if (d && !isToday) setDatoCacheado(detailCacheKey, d);
    }

    dpKpiEmer.textContent = nf0.format(Number(d?.emergencias?.veces || 0));
    dpKpiEmerM.textContent = (() => {
      const m = Number(d?.emergencias?.minutos || 0);
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return h ? `${h} h ${mm} min` : `${mm} min`;
    })();
    dpKpiCont.textContent = nf0.format(Number(d?.contadorDiaTicks ?? 0));
    dpFirstOn.textContent = fmtHM(d?.run?.firstOn);
    dpLastOff.textContent = fmtHM(d?.run?.lastOff);
    dpRunTotal.textContent = (() => {
      const m = Number(d?.run?.totalRunMin || 0);
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return h ? `${h} h ${mm} min` : `${mm} min`;
    })();

    renderDpTableFromIntervals(d?.run?.intervals || []);

    const bins = Array.isArray(d?.bins1h) ? d.bins1h : [];
    const lbls = bins.map(b => b.label || '—');
    const hourly = bins.map(b => Math.max(0, Number(b.produced || b.producedTicks || 0)));
    const cumulative = [];
    let acc = 0;
    for (const v of hourly) {
      acc += v;
      cumulative.push(acc);
    }

    const ch = ensureDpChart();
    if (ch) {
      ch.data.labels = lbls;
      ch.data.datasets[0].label = 'Acumulado horario';
      ch.data.datasets[0].data = cumulative;
      ch.data._hourly = hourly;
      ch.update();
    }
  } catch (e) {
    console.error(e);
    dpRows.innerHTML = `<tr>
      <td colspan="7">
        <div class="dp-error">No se pudo cargar el detalle: ${e.message || 'Error desconocido'}</div>
      </td>
    </tr>`;
    dpFoot.innerHTML = `<tr><td colspan="7" class="muted">—</td></tr>`;
  } finally {
    setTimeout(() => {
      dpBusy = false;
    }, 120);
  }
}

/* ================== Exportar Excel (por máquina) ================== */
btnExport?.addEventListener('click', async () => {
  const btn = btnExport;
  try {
    const boxId = machineSelect?.value;
    const start = startDate?.value;
    const end = endDate?.value;
    const name = machineSelect?.selectedOptions?.[0]?.textContent || '';
    if (!boxId || !start || !end) return;

    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generando…';
    }

    const r = await apiPost('/api/history/export', { boxId, start, end, name });
    if (!r?.ok || !r?.file) throw new Error(r?.message || 'No se pudo generar el Excel');

    const downloadName = makeReportFilename(name, start, end);
    const a = document.createElement('a');
    a.href = r.file;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    if (btn) {
      btn.disabled = false;
      btn.textContent = prev;
    }
  } catch (e) {
    console.error(e);
    alert(e.message || 'Error al exportar');
    if (btnExport) {
      btnExport.disabled = false;
      btnExport.textContent = 'Informe';
    }
  }
});

/* ================== Exportar Excel GENERAL (todas las máquinas filtradas) ================== */
btnExportAll?.addEventListener('click', async () => {
  try {
    const start = startDate?.value;
    const end = endDate?.value;
    if (!start || !end) return alert('Selecciona rango de fechas');

    const company = companySelect?.value || '';
    const provider = providerSelect?.value || '';
    const q = (machineSearch?.value || '').trim().toLowerCase();
    const filtered = allBoxes.filter(b => {
      const name = (b.boxName || b.boxId || '').toLowerCase();
      const idn = String(b.boxId || '').replace(/\D/g, '');
      const okQ = !q || name.includes(q) || (idn && idn.includes(q.replace(/\D/g, '')));
      const okC = !company || String(b.company || '') === company;
      const okP = !provider || String(b.provider || '') === provider;
      return okQ && okC && okP;
    });

    if (!filtered.length) return alert('No hay máquinas para exportar con los filtros actuales.');

    const btn = btnExportAll;
    const prev = btn?.textContent;
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generando…';
    }

    const machines = filtered.map(b => ({ boxId: b.boxId, name: b.boxName || b.boxId }));
    const r = await apiPost('/api/history/exportGeneral', { start, end, machines });
    if (!r?.ok || !r?.file) throw new Error(r?.message || 'No se pudo generar el Excel general');

    const a = document.createElement('a');
    a.href = r.file;
    a.download = r.filename || `historicos_general_${start}_a_${end}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    if (btn) {
      btn.disabled = false;
      btn.textContent = prev;
    }
  } catch (e) {
    console.error(e);
    alert(e.message || 'Error al exportar informe general');
    if (btnExportAll) {
      btnExportAll.disabled = false;
      btnExportAll.textContent = 'Informe general';
    }
  }
});

/* ================== Estilos (panel detalle) ================== */
(function injectPanelStyles() {
  const css = `.dpanel table{width:100%;border-collapse:collapse;table-layout:fixed;}
    .dpanel table th, .dpanel table td{padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:middle;font-size:13px;}
    .dpanel table th{white-space: normal;line-height: 1.2;overflow-wrap: anywhere;}
    .dpanel table td{ white-space: nowrap; }
    .dpanel table :is(th,td):nth-child(1), .dpanel table :is(th,td):nth-child(2){ text-align:center; }
    .dpanel table :is(th,td):nth-child(3), .dpanel table :is(th,td):nth-child(4), .dpanel table :is(th,td):nth-child(5), .dpanel table :is(th,td):nth-child(6), .dpanel table :is(th,td):nth-child(7){ text-align:right; font-variant-numeric:tabular-nums; }
    .dpanel table :is(th,td):nth-child(1){ width:8ch; }
    .dpanel table :is(th,td):nth-child(2){ width:8ch; }
    .dpanel table :is(th,td):nth-child(3){ width:11ch; }
    .dpanel table :is(th,td):nth-child(4){ width:12ch; }
    .dpanel table :is(th,td):nth-child(5){ width:10ch; }
    .dpanel table :is(th,td):nth-child(6){ width:12ch; }
    .dpanel table :is(th,td):nth-child(7){ width:12ch; }
    .dpanel tfoot td{border-top:1px solid rgba(255,255,255,.15);font-weight:600;}
    .dpanel .dp-loading{ height:120px; }
    @media (max-width: 1280px){ .dpanel table th{ font-size:12px; } }`;
  const tag = document.createElement('style');
  tag.setAttribute('data-from', 'historicos.js');
  tag.textContent = css;
  document.head.appendChild(tag);
})();

/* ================== Leer parámetros de URL ================== */
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    machine: params.get('machine'),
    start: params.get('start'),
    end: params.get('end'),
    auto: params.get('auto'),
    hasStart: params.has('start'),
    hasEnd: params.has('end')
  };
}

/* ================== Boot ================== */
(async function init() {
  const urlParams = getUrlParams();
  await ensureLogged().catch(() => { });
  await loadMachines().catch(e => console.error(e));
  compactDpHeader();

  let selectedBox = null;
  if (urlParams.machine) {
    const machineName = urlParams.machine.toLowerCase();
    const option = Array.from(machineSelect.options).find(opt => opt.textContent.toLowerCase() === machineName);
    if (option) {
      machineSelect.value = option.value;
      selectedBox = allBoxes.find(b => b.boxId === option.value);
    }
  }

  if (urlParams.hasEnd && urlParams.end) {
    endDate.value = urlParams.end;
  } else {
    const today = new Date();
    endDate.value = toInput(today);
  }

  if (urlParams.hasStart && urlParams.start === '') {
    if (selectedBox && selectedBox.startDate) {
      try {
        const dateFromDB = new Date(selectedBox.startDate);
        const year = dateFromDB.getFullYear();
        const month = String(dateFromDB.getMonth() + 1).padStart(2, '0');
        const day = String(dateFromDB.getDate()).padStart(2, '0');
        startDate.value = `${year}-${month}-${day}`;
      } catch (e) {
        console.error("Error al formatear startDate:", e);
        setRange(7);
      }
    } else {
      setRange(7);
    }
  } else if (urlParams.hasStart && urlParams.start) {
    startDate.value = urlParams.start;
  } else {
    setRange(7);
  }

  if (urlParams.auto === 'true') {
    if (!startDate.value || !endDate.value || !machineSelect.value) {
      console.warn('Auto-búsqueda detenida, faltan datos. Usando 7 días.');
      if (!startDate.value) setRange(7);
    }
    document.getElementById('hisEmpty').style.display = 'none';
    doSearch();
  } else {
    document.getElementById('hisEmpty').style.display = 'block';
  }
})();