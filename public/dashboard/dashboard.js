// ========= MENU / LOGOUT =========
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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleMenu(false); });

// --- LÓGICA DEL MODAL DE LOGOUT ---
let logoutModal;
function ensureLogoutModal() {
  if (logoutModal) return logoutModal;
  const overlay = document.querySelector('.modal[data-kind="logout"]') || (() => {
    const el = document.createElement('div');
    el.className = 'modal';
    el.dataset.kind = 'logout';
    if (!document.getElementById('modal-styles')) {
      const modalStyle = document.createElement('style');
      modalStyle.id = 'modal-styles';
      modalStyle.textContent = `
.modal { position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; opacity: 0; visibility: hidden; transition: all .2s ease; }
.modal.open { opacity: 1; visibility: visible; }
.modal-dialog { background: var(--card, #111827); color: var(--txt, #e6eaf2); padding: 24px; border-radius: 16px; width: min(420px, 90vw); box-shadow: 0 10px 30px rgba(0,0,0,.3); transform: scale(0.95); transition: all .2s ease; }
.modal.open .modal-dialog { transform: scale(1); }
.modal-dialog h3 { margin: 0 0 10px; font-size: 1.2rem; }
.modal-dialog p { margin: 0 0 20px; opacity: 0.8; }
.modal-buttons { display: flex; gap: 10px; justify-content: flex-end; }
.modal-buttons button { padding: 9px 15px; border: 0; border-radius: 8px; cursor: pointer; font-weight: 600; }
.modal-buttons .cancel { background: rgba(255,255,255,.1); color: white; }
.modal-buttons .danger { background: #e53e3e; color: white; }
`;
      document.head.appendChild(modalStyle);
    }
    document.body.appendChild(el);
    return el;
  })();
  overlay.innerHTML = `
<div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="logoutTitle">
  <h3 id="logoutTitle">¿Cerrar sesión?</h3>
  <p>Se cerrará tu sesión actual. Puedes cancelar para seguir en la página.</p>
  <div class="modal-buttons">
    <button type="button" class="cancel">Cancelar</button>
    <button type="button" class="danger confirm">Cerrar sesión</button>
  </div>
</div>`;
  const open = () => { overlay.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const close = () => { overlay.classList.remove('open'); document.body.style.overflow = ''; };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (overlay.classList.contains('open') && e.key === 'Escape') close(); });
  overlay.querySelector('.cancel').addEventListener('click', close);
  overlay.querySelector('.confirm').addEventListener('click', async () => {
    try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch { }
    try { localStorage.removeItem('vbox_sid'); } catch { }
    try { sessionStorage.clear(); } catch { }
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
// --- FIN MODAL ---

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const now = () => Date.now();

// ========= SESIÓN =========
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

// ========= TOAST =========
const TOAST_MS = 5000;
function showToast(message, timeout = TOAST_MS, anchorEl = null) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
<span class="msg"></span>
<button class="close" aria-label="Cerrar">
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71 2.89 18.3 9.17 12 2.89 5.71 4.3 4.29 10.59 10.6 16.89 4.29z"/>
  </svg>
</button>
`;
    document.body.appendChild(toast);
    toast.querySelector('.close').addEventListener('click', () => toast.classList.remove('show'));
  }
  toast.querySelector('.msg').textContent = message;
  function positionToast() {
    const ref = anchorEl;
    if (ref && ref.getBoundingClientRect) {
      toast.style.visibility = 'hidden';
      requestAnimationFrame(() => {
        const r = ref.getBoundingClientRect();
        const tw = toast.offsetWidth;
        const th = toast.offsetHeight;
        let left = r.left - 12 - tw;
        const fitsLeft = left >= 12;
        if (fitsLeft) {
          toast.style.left = `${left}px`;
          toast.style.right = 'auto';
          toast.style.top = `${Math.max(8, r.top + (r.height - th) / 2)}px`;
        } else {
          toast.style.left = 'auto';
          toast.style.right = '22px';
          toast.style.top = '84px';
        }
        toast.style.visibility = 'visible';
      });
    } else {
      toast.style.left = 'auto';
      toast.style.right = '22px';
      toast.style.top = '84px';
    }
  }
  positionToast();
  window.addEventListener('resize', positionToast, { once: true });
  requestAnimationFrame(() => toast.classList.add('show'));
  if (timeout > 0) setTimeout(() => toast.classList.remove('show'), timeout);
}
function welcomeOnce() {
  if (sessionStorage.getItem('welcomed')) return;
  try {
    const u = JSON.parse(sessionStorage.getItem('user') || '{}');
    const name = (u?.username || 'usuario').toString();
    showToast(`Bienvenido, ${name}`, TOAST_MS, null);
  } catch {
    showToast('Bienvenido', TOAST_MS, null);
  }
  sessionStorage.setItem('welcomed', '1');
}
welcomeOnce();

// ========= API / STATE =========
const tbody = document.getElementById('boxesTbody');
const sid = localStorage.getItem('vbox_sid');
const API = '/api/monitor';
const API_MACHINES = '/api/maquinas';

const DEFAULT_NAMES = [
  'CONTADOR GENERAL', 'FUNCIONANDO', 'ESTADO EMERGENCIA',
  'LADO A FUNCIONANDO', 'LADO B FUNCIONANDO'
];

// KPI Total temporada y máquinas visibles
const totalSeasonEl = document.getElementById('totalSeasonAll');
const machinesVisibleEl = document.getElementById('machinesVisible');
let totalSeasonLast = 0;
let machinesVisibleLast = 0;
let _totalRecalcTick = null;
let _totalAnimId = 0;

const nfES = new Intl.NumberFormat('es-CL');

// ======= Season helpers anti-parpadeo =======
const DOWN_TOLERANCE = 5000;

function getRowByBoxId(boxId) {
  return tbody?.querySelector(`tr[data-box-id="${boxId}"]`) || null;
}
function readSeasonFromRow(tr) {
  const raw = tr?.dataset?.season;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
function writeSeasonToRow(tr, season) {
  const seasonCell = tr.querySelector('.td-season');
  if (season == null || !Number.isFinite(season)) return;
  const prev = readSeasonFromRow(tr);
  const next = (prev != null && season + DOWN_TOLERANCE < prev) ? prev : season;
  if (seasonCell) seasonCell.textContent = fmtInt(next);
  tr.dataset.season = String(Math.trunc(next));
}

function animateNumber(el, from, to, dur = 600) {
  if (!el) return;
  if (from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
    el.textContent = Number.isFinite(to) ? nfES.format(Math.trunc(to)) : '—';
    return;
  }
  const start = performance.now();
  const id = ++_totalAnimId;
  function step(t) {
    if (id !== _totalAnimId) return;
    const p = Math.min(1, (t - start) / dur);
    const val = Math.round(from + (to - from) * p);
    el.textContent = nfES.format(val);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function setTotalSeasonValue(n) {
  if (!totalSeasonEl) return;
  if (n == null || !Number.isFinite(n)) { totalSeasonEl.textContent = '—'; return; }
  animateNumber(totalSeasonEl, totalSeasonLast || 0, n);
  totalSeasonLast = n;
}
function setMachinesVisibleValue(n) {
  if (!machinesVisibleEl) return;
  if (n == null || !Number.isFinite(n)) { machinesVisibleEl.textContent = '—'; return; }
  animateNumber(machinesVisibleEl, machinesVisibleLast || 0, n);
  machinesVisibleLast = n;
}
function recalcTotalsNow() {
  if (!tbody) { setTotalSeasonValue(null); setMachinesVisibleValue(null); return; }
  const rows = Array.from(tbody.querySelectorAll('tr'));
  let sum = 0, any = false, count = 0;
  for (const tr of rows) {
    if (tr.style.display === 'none') continue;
    count++;
    const v = Number(tr?.dataset?.season);
    if (Number.isFinite(v)) { sum += v; any = true; }
  }
  setTotalSeasonValue(any ? sum : null);
  setMachinesVisibleValue(count || 0);
}
function scheduleTotalSeasonRecalc() {
  clearTimeout(_totalRecalcTick);
  _totalRecalcTick = setTimeout(recalcTotalsNow, 50);
}

// Helpers API
async function api(path, params = {}, headers = {}) {
  const url = new URL(path, window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v); });
  const resp = await fetch(url.pathname + url.search, {
    credentials: 'include',
    headers: { 'x-vbox-sid': sid || '', ...headers }
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) location.href = '/login';
    throw new Error(json.message || `Error API ${resp.status}`);
  }
  return json;
}

/* initialCounter */
async function fetchInitialCounters() { return api(`${API}/initial-counters`); }
const initialsByName = new Map();
const initialsByNum = new Map();
function extractNumKey(name) { return (String(name || '').match(/\d+/)?.[0] || '').trim(); }
function getInitialForMachine(name) {
  const k1 = String(name || '').toLowerCase();
  const k2 = extractNumKey(name);
  if (initialsByName.has(k1)) return initialsByName.get(k1);
  if (k2 && initialsByNum.has(k2)) return initialsByNum.get(k2);
  return null;
}

// Metadatos
const typeByName = new Map();
const companyByName = new Map();
const providerByName = new Map();
const startDateByName = new Map();
const typesSet = new Set();
const companiesSet = new Set();
const providersSet = new Set();

async function loadExtraMachineData() {
  try {
    const res = await fetch(API_MACHINES, { credentials: 'include', headers: { 'x-vbox-sid': sid || '' } });
    if (!res.ok) throw new Error(`Error ${res.status} al cargar ${API_MACHINES}`);
    const { list = [] } = await res.json();
    typeByName.clear(); companyByName.clear(); providerByName.clear(); startDateByName.clear();
    typesSet.clear(); companiesSet.clear(); providersSet.clear();
    for (const m of list) {
      const k = String(m.machineName || '').toLowerCase();
      if (!k) continue;
      const tipo = (m.type || '').trim();
      const comp = (m.company || '').trim();
      const prov = (m.provider || '').trim();
      const startDateRaw = m.startDate;
      if (tipo) { typeByName.set(k, tipo); typesSet.add(tipo); }
      if (comp) { companyByName.set(k, comp); companiesSet.add(comp); }
      if (prov) { providerByName.set(k, prov); providersSet.add(prov); }
      if (startDateRaw) { startDateByName.set(k, startDateRaw); }
    }
    fillUniqueSelect(document.getElementById('filterType'), typesSet, 'Todos');
    fillUniqueSelect(document.getElementById('filterCompany'), companiesSet, 'Todas');
    fillUniqueSelect(document.getElementById('filterProvider'), providersSet, 'Todos');
  } catch (e) {
    console.error('Error cargando datos extra de máquinas:', e);
  }
}
function fillUniqueSelect(selectEl, set, firstLabel) {
  if (!selectEl) return;
  const arr = [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
  selectEl.innerHTML = `<option value="">${firstLabel}</option>` + arr.map(v => `<option value="${v}">${v}</option>`).join('');
}

// ========= BADGES / FORMAT =========
function badgeOnline(v) {
  const online = Number(v) === 1;
  return `<span class="badge ${online ? 'success' : 'neutral'}">${online ? 'En línea' : 'Fuera de línea'}</span>`;
}
function badgeEstadoFromFlags({ funcionando = null, emergencia = null, ladoA = 0, ladoB = 0 } = {}) {
  const a = Number(ladoA) === 1;
  const b = Number(ladoB) === 1;
  const emer = Number(emergencia) === 1;
  const func = Number(funcionando) === 1;
  if (emer) return `<span class="badge danger">Emergencia</span>`;
  if (a && b) return `<span class="badge success">Operativo completo</span>`;
  if (a && !b) return `<span class="badge warning">Operativo lado A</span>`;
  if (b && !a) return `<span class="badge warning">Operativo lado B</span>`;
  if (func) return `<span class="badge success">Operativo</span>`;
  return `<span class="badge neutral">Sin Operación</span>`;
}
function fmtInt(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  try { return nfES.format(Math.trunc(n)); } catch { return String(n); }
}
function fmtDate(dateStringOrObject) {
  if (!dateStringOrObject) return '—';
  try {
    const d = new Date(dateStringOrObject);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    if (isNaN(d.getTime()) || yyyy < 2000) return '—';
    return `${yyyy}-${mm}-${dd}`;
  } catch (e) {
    console.error("Error formateando fecha:", dateStringOrObject, e);
    return '—';
  }
}

// ===== rowSkeleton (8 celdas) =====
function rowSkeleton(box) {
  const key = (box.boxName || '').toLowerCase();
  const tipo = typeByName.get(key) || '—';
  const comp = companyByName.get(key) || '—';
  const prov = providerByName.get(key) || '—';
  const startDateRaw = startDateByName.get(key);
  const startDateFmt = fmtDate(startDateRaw);
  return `
<tr data-box-id="${box.boxId}" data-name="${key}" data-season=""
  data-type="${(tipo || '').toLowerCase()}"
  data-company="${(comp || '').toLowerCase()}"
  data-provider="${(prov || '').toLowerCase()}"
  data-startdate="${startDateFmt === '—' ? '' : startDateFmt}">
  <td>${box.boxName || '-'}</td>
  <td class="td-type">${tipo}</td>
  <td class="td-company">${comp}</td>
  <td class="td-provider">${prov}</td>
  <td class="td-startdate">${startDateFmt}</td>
  <td class="td-season"><span class="skel"></span></td>
  <td class="td-online">${badgeOnline(box.state)}</td>
  <td class="td-estado"><span class="skel"></span></td>
</tr>
`;
}

/* ===== filtros ===== */
function normalized(s) { return (s || '').toString().trim().toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' '); }
const searchInput = document.getElementById('searchBox');
const statusSelect = document.getElementById('filterConn');   // "" | "1" (En línea) | "0" (Fuera de línea)
const stateSelect = document.getElementById('filterState');   // "" | "operativo" | "full" | "ladoA" | "ladoB" | "emergencia" | "sin"
const typeSelect = document.getElementById('filterType');
const companySelect = document.getElementById('filterCompany');
const providerSelect = document.getElementById('filterProvider');

function matchesName(box, q) {
  if (!q) return true;
  const name = box.boxName || '';
  const target = normalized(name) + ' ' + name.replace(/\D/g, '');
  const num = name.match(/\d+/)?.[0] || '';
  return target.includes(q) || (!!num && num.includes(q.replace(/\D/g, '')));
}

// Estado interno
function estadoBucket(flags) {
  const { funcionando = null, emergencia = null, ladoA = 0, ladoB = 0 } = flags || {};
  const a = Number(ladoA) === 1, b = Number(ladoB) === 1, emer = Number(emergencia) === 1, func = Number(funcionando) === 1;
  if (emer) return 'emergencia';
  if (a && b) return 'full';
  if (a && !b) return 'ladoA';
  if (b && !a) return 'ladoB';
  if (func) return 'operativo';
  return 'sin';
}

// ===== conexión en vivo para filtros =====
const onlineById = new Map(); // "1" | "0"
function setOnlineState(boxId, state) {
  onlineById.set(String(boxId), String(state));
}
function getOnlineState(boxId, fallback) {
  const v = onlineById.get(String(boxId));
  return v != null ? v : String(fallback);
}

function applyFilters() {
  const q = normalized(searchInput?.value || '');
  const wantStat = statusSelect?.value ?? '';
  const wantEst = stateSelect?.value ?? '';
  const wantType = typeSelect?.value || '';
  const wantComp = companySelect?.value || '';
  const wantProv = providerSelect?.value || '';

  const operativoGroup = new Set(['operativo', 'full', 'ladoA', 'ladoB']);

  [...tbody.querySelectorAll('tr')].forEach(tr => {
    const id = tr.getAttribute('data-box-id');
    const box = items.find(b => String(b.boxId) === String(id));
    if (!box) { tr.style.display = 'none'; return; }

    const nameOk = matchesName(box, q);

    // Estado de conexión actual (map en vivo; cae a box.state si no lo tenemos)
    const connNow = getOnlineState(box.boxId, box.state); // "1" o "0"

    // Si el usuario eligió conexión explícita, respetarla.
    // Si NO eligió conexión pero SÍ eligió estado (p.ej. "operativo"), exigimos En línea por defecto.
    let connRequired = wantStat;
    if (!connRequired && wantEst) connRequired = "1";

    const statOk = !connRequired || (String(connNow) === String(connRequired));

    const flags = tr._flags || {};
    const bucket = estadoBucket(flags);

    let estOk = true;
    if (wantEst) {
      if (wantEst === 'operativo') estOk = operativoGroup.has(bucket);
      else estOk = (bucket === wantEst);
    }

    const key = (box.boxName || '').toLowerCase();
    const tipo = typeByName.get(key) || '';
    const comp = companyByName.get(key) || '';
    const prov = providerByName.get(key) || '';
    const typeOk = !wantType || (tipo === wantType);
    const compOk = !wantComp || (comp === wantComp);
    const provOk = !wantProv || (prov === wantProv);

    tr.style.display = (nameOk && statOk && estOk && typeOk && compOk && provOk) ? '' : 'none';
  });

  scheduleTotalSeasonRecalc();
  refreshChartIfVisible();
}

let filterTick;
function debouncedFilter() { clearTimeout(filterTick); filterTick = setTimeout(() => { applyFilters(); applySort(); }, 100); }
[searchInput, statusSelect, stateSelect, typeSelect, companySelect, providerSelect].forEach(el => {
  if (el) { el.addEventListener('input', debouncedFilter); el.addEventListener('change', debouncedFilter); }
});

// ======= UPDATE ROWS (robusto) =======
function updateRow(boxId, { season = undefined, funcionando = null, emergencia = null, ladoA = 0, ladoB = 0 } = {}) {
  const tr = getRowByBoxId(boxId);
  if (!tr) return;

  if (season !== undefined) {
    if (season != null && Number.isFinite(Number(season))) {
      writeSeasonToRow(tr, Number(season));
    }
  }

  const estadoCell = tr.querySelector('.td-estado');
  if (estadoCell) estadoCell.innerHTML = badgeEstadoFromFlags({ funcionando, emergencia, ladoA, ladoB });

  tr._flags = { funcionando, emergencia, ladoA, ladoB };
}
function updateOnline(boxId, state) {
  const tr = tbody.querySelector(`tr[data-box-id="${boxId}"]`);
  if (!tr) return;
  const onlineCell = tr.querySelector('.td-online');
  if (onlineCell) onlineCell.innerHTML = badgeOnline(state);
  setOnlineState(boxId, state);
}

// ========= QUEUE & AUTO-REFRESH =========
class Queue {
  constructor(worker, concurrency = 4) {
    this.worker = worker; this.concurrency = concurrency;
    this.queue = []; this.running = 0; this.closed = false;
  }
  push(item, priority = false) {
    if (this.closed) return;
    if (priority) this.queue.unshift(item); else this.queue.push(item);
    this._run();
  }
  _run() {
    while (this.running < this.concurrency && this.queue.length) {
      const it = this.queue.shift();
      this.running++;
      Promise.resolve()
        .then(() => this.worker(it))
        .catch(e => console.error(`[Queue worker error for item ${it?.boxId || JSON.stringify(it)}]`, e))
        .finally(() => { this.running--; this._run(); });
    }
  }
  clear() { this.queue.length = 0; }
}

const viewport = document.querySelector('.table-viewport') || document;
const visibleSet = new Set();
const io = new IntersectionObserver(entries => {
  entries.forEach(e => {
    const tr = e.target;
    const id = tr.getAttribute('data-box-id');
    if (!id) return;
    if (e.isIntersecting) visibleSet.add(id);
    else visibleSet.delete(id);
  });
}, { root: viewport === document ? null : viewport, threshold: 0.01 });

const REFRESH_MS = 20000;
const ONLINE_REFRESH_MS = 10000;
let refreshInterval = null;
let onlineInterval = null;

let items = [];
const tagNameMem = new Map();

const qTag = new Queue(async (b) => {
  try {
    const cfg = await api(`${API}/tagcfg`, { boxId: b.boxId });
    const t = cfg.tags || {};
    const theList = [t.contador?.name, t.funcionando?.name, t.emergencia?.name, t.ladoA?.name, t.ladoB?.name].filter(Boolean);
    const namesFinal = theList.length ? theList : DEFAULT_NAMES;
    tagNameMem.set(b.boxId, namesFinal);
  } catch (error) {
    console.warn(`Error fetching tag config for ${b.boxId} (${b.boxName}):`, error.message);
    tagNameMem.set(b.boxId, DEFAULT_NAMES);
  }
}, 4);

const qRT = new Queue(async (b) => {
  try {
    const names = tagNameMem.get(b.boxId) || DEFAULT_NAMES;
    const rt = await api(`${API}/realtime`, { boxId: b.boxId, names: names.join(',') });

    const init = getInitialForMachine(b.boxName);
    const contadorVal = rt?.contador;
    const contadorNum = (contadorVal !== null && contadorVal !== undefined && !isNaN(Number(contadorVal)))
      ? Number(contadorVal) : null;

    let seasonCalc;
    if (init != null && Number.isFinite(init) && contadorNum != null && Number.isFinite(contadorNum)) {
      seasonCalc = Math.max(0, contadorNum - init);
      const tr = getRowByBoxId(b.boxId);
      if (tr) {
        const prev = readSeasonFromRow(tr);
        if (prev != null && seasonCalc + DOWN_TOLERANCE < prev) {
          seasonCalc = prev;
        }
      }
    } else {
      seasonCalc = undefined;
    }

    updateRow(b.boxId, {
      season: seasonCalc,
      funcionando: rt?.funcionando ?? null,
      emergencia: rt?.emergencia ?? null,
      ladoA: rt?.ladoA ?? 0,
      ladoB: rt?.ladoB ?? 0,
    });
  } catch (error) {
    console.error(`Error processing realtime for box ${b.boxId} (${b.boxName}):`, error);
    updateRow(b.boxId, { season: undefined, funcionando: null, emergencia: null, ladoA: 0, ladoB: 0 });
  } finally {
    scheduleTotalSeasonRecalc();
    refreshChartIfVisible();
  }
}, 8);

async function scheduleRealtimeCycle() {
  if (!items.length) return;
  const visibleIds = Array.from(visibleSet);
  items.forEach(b => {
    const isVisible = visibleIds.includes(String(b.boxId));
    qRT.push(b, isVisible);
  });
}
async function refreshOnlineBadges() {
  try {
    const data = await api(`${API}/boxes`);
    const latest = flattenBoxList(data);
    latest.forEach(b => {
      updateOnline(b.boxId, b.state);
    });
    // Reaplicar filtros para insertar/quitar filas acorde a cambios en línea
    applyFilters();
  } catch (e) { console.error('Error refreshing online badges:', e); }
}
function startAutoRefresh() {
  stopAutoRefresh();
  refreshInterval = setInterval(scheduleRealtimeCycle, REFRESH_MS);
  onlineInterval = setInterval(refreshOnlineBadges, ONLINE_REFRESH_MS);
}
function stopAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval), (refreshInterval = null);
  if (onlineInterval) clearInterval(onlineInterval), (onlineInterval = null);
  qTag.clear(); qRT.clear();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopAutoRefresh();
  else { scheduleRealtimeCycle(); refreshOnlineBadges(); startAutoRefresh(); }
});

function flattenBoxList(data) {
  const groups = data?.result?.list || data?.list || [];
  const rows = [];
  for (const g of groups) for (const b of (g.boxList || [])) rows.push(b);
  return rows;
}

// ==== ORDENAR (FIX “0 al medio”) ====
let currentSort = { key: 'season', dir: 'desc' };
const sortBtns = document.querySelectorAll('.sort');
sortBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    if (currentSort.key !== key) currentSort = { key, dir: 'desc' };
    else if (currentSort.dir === 'desc') currentSort.dir = 'asc';
    else if (currentSort.dir === 'asc') currentSort = { key, dir: '' };
    else currentSort = { key, dir: 'desc' };

    sortBtns.forEach(b => b.classList.remove('active', 'asc', 'desc'));
    if (currentSort.key && currentSort.dir) {
      const b = document.querySelector(`.sort[data-key="${currentSort.key}"]`);
      b?.classList.add('active', currentSort.dir);
    }
    applySort();
  });
});
function applySort() {
  const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => tr.style.display !== 'none');
  if (!currentSort.key || !currentSort.dir) {
    rows.sort((a, b) => (a.dataset.name || '').localeCompare(b.dataset.name || ''));
  } else {
    const k = currentSort.key;
    const dirMul = currentSort.dir === 'asc' ? 1 : -1;
    const valFor = (tr) => {
      const v = Number(tr.dataset[k]);
      if (Number.isFinite(v)) return v;
      return currentSort.dir === 'asc' ? Infinity : -Infinity;
    };
    rows.sort((a, b) => (valFor(a) - valFor(b)) * dirMul);
  }
  rows.forEach(tr => tbody.appendChild(tr));
  scheduleTotalSeasonRecalc();
  refreshChartIfVisible();
}

// ========= CARGA INICIAL =========
async function getBoxes() { return api(`${API}/boxes`); }
async function loadTable() {
  try {
    if (!sid) {
      tbody.innerHTML = `<tr><td colspan="8">No hay sesión de V-BOX (sid). Inicia sesión nuevamente.</td></tr>`;
      return;
    }
    tbody.innerHTML = `<tr class="loading-row"><td colspan="8"><div class="loader"><span class="ring"></span> Cargando datos...</div></td></tr>`;

    await loadExtraMachineData();

    try {
      const { list = [] } = await fetchInitialCounters();
      localStorage.setItem('csf_initial_counters', JSON.stringify(list));
      initialsByName.clear(); initialsByNum.clear();
      list.forEach(it => {
        const nm = String(it.machineName || '').toLowerCase();
        const val = Number(it.initialCounter);
        if (nm && Number.isFinite(val)) initialsByName.set(nm, val);
        const k2 = extractNumKey(nm);
        if (k2 && Number.isFinite(val)) initialsByNum.set(k2, val);
      });
    } catch (e) {
      console.warn('Error fetching initial counters, attempting to use cache.', e);
      try {
        const cached = JSON.parse(localStorage.getItem('csf_initial_counters') || '[]');
        initialsByName.clear(); initialsByNum.clear();
        cached.forEach(it => {
          const nm = String(it.machineName || '').toLowerCase();
          const val = Number(it.initialCounter);
          if (nm && Number.isFinite(val)) initialsByName.set(nm, val);
          const k2 = extractNumKey(nm);
          if (k2 && Number.isFinite(val)) initialsByNum.set(k2, val);
        });
      } catch (cacheError) {
        console.error("Failed to load initial counters from cache:", cacheError);
      }
    }

    const data = await getBoxes();
    items = flattenBoxList(data);
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8">No hay máquinas disponibles en VBox.</td></tr>`;
      return;
    }

    // Inicializar mapa de conexión
    items.forEach(b => setOnlineState(b.boxId, b.state));

    tbody.innerHTML = items.map(rowSkeleton).join('');
    [...tbody.querySelectorAll('tr[data-box-id]')].forEach(tr => io.observe(tr));

    items.forEach(b => qTag.push(b, true));
    await sleep(200);
    await scheduleRealtimeCycle();

    refreshOnlineBadges();
    startAutoRefresh();

    applyFilters();
    applySort();
  } catch (err) {
    console.error("Error fatal en loadTable:", err);
    tbody.innerHTML = `<tr><td colspan="8">Error cargando datos: ${err.message}</td></tr>`;
  }
}

// ====== REDIRECCIÓN A HISTÓRICOS ======
tbody?.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-box-id]');
  if (!tr) return;
  const machineName = tr.querySelector('td:first-child')?.textContent?.trim();
  const startDateValue = tr.dataset.startdate;
  if (!machineName) return;
  const endDateValue = fmtDate(new Date());
  const params = new URLSearchParams();
  params.set('machine', machineName);
  params.set('start', startDateValue || '');
  params.set('end', endDateValue);
  params.set('auto', 'true');
  const url = `/historicos/historicos.html?${params.toString()}`;
  window.open(url, '_blank');
});
ensureLogged().then(loadTable);

// ====== EXPORTAR EXCEL (.xlsx) ======
const exportBtn = document.getElementById('btnExport');
const btnSpinner = document.querySelector('#btnExport .spinner');
const btnText = document.querySelector('#btnExport .btn-text');

function setBtnLoading(loading) {
  if (!exportBtn) return;
  exportBtn.disabled = loading;
  if (btnSpinner) btnSpinner.classList.toggle('hidden', !loading);
  if (btnText) btnText.textContent = loading ? 'Generando…' : 'Descargar Datos';
}
async function downloadExcel() {
  try {
    setBtnLoading(true);
    showToast('Generando informe…', 2500, exportBtn);
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => tr.style.display !== 'none');
    const boxIds = rows.map(tr => tr.getAttribute('data-box-id')).filter(Boolean);
    if (boxIds.length === 0) {
      showToast('No hay máquinas visibles para exportar.', 3000, exportBtn);
      return;
    }
    const resp = await fetch('/api/monitor/export.xlsx', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-vbox-sid': sid || '' },
      body: JSON.stringify({ boxIds })
    });
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({ message: `Error ${resp.status}` }));
      throw new Error(j.message || `Error ${resp.status} al generar Excel`);
    }
    const blob = await resp.blob();
    if (blob.type === 'application/json') {
      const errorJson = JSON.parse(await blob.text());
      throw new Error(errorJson.message || 'Error del servidor al generar Excel');
    }
    const url = URL.createObjectURL(blob);
    const stamp = new Date();
    const pad2 = (n) => String(n).padStart(2, '0');
    const fname = `datos_maquinas_${stamp.getFullYear()}-${pad2(stamp.getMonth() + 1)}-${pad2(stamp.getDate())}_${pad2(stamp.getHours())}-${pad2(stamp.getMinutes())}.xlsx`;
    const a = document.createElement('a');
    a.href = url; a.download = fname; document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
    showToast('Excel descargado', 2400, exportBtn);
  } catch (e) {
    console.error("Error en downloadExcel:", e);
    showToast(e.message || 'Error al descargar', 3500, exportBtn);
  } finally {
    setBtnLoading(false);
  }
}
exportBtn?.addEventListener('click', downloadExcel);

/* ===================== CONTROL PASS ===================== */
(function () {
  function injectCpStyles() {
    if (document.getElementById('cp-style')) return;
    const css = `
.cp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:99999}
.cp-card{background:var(--card,#111827);color:var(--txt,#e6eaf2);width:min(440px,92vw);border-radius:18px;box-shadow:var(--shadow,0 10px 30px rgba(0,0,0,.35));padding:22px}
.cp-title{font-weight:700;font-size:18px;margin:0 0 6px}
.cp-sub{opacity:.85;margin:0 0 16px}
.cp-input{width:100%;padding:12px 14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;color:inherit;outline:none}
.cp-actions{display:flex;gap:10px;margin-top:16px;justify-content:flex-end}
.cp-btn{padding:10px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}
.cp-btn.primary{background:var(--brand,#0066fe);border-color:transparent;color:white;font-weight:600}
.cp-err{color:#ff6b6b;margin-top:10px;min-height:20px}`;
    const style = document.createElement('style'); style.id = 'cp-style'; style.textContent = css; document.head.appendChild(style);
  }
  function showDeny(msg) {
    injectCpStyles();
    const o = document.createElement('div'); o.className = 'cp-overlay';
    o.innerHTML = `<div class="cp-card" role="dialog" aria-modal="true" aria-labelledby="cp-title"><h3 id="cp-title" class="cp-title">Acceso restringido</h3><p class="cp-sub">${msg || 'Permiso denegado.'}</p><div class="cp-actions"><button class="cp-btn" id="cp-back">Volver</button></div></div>`;
    document.body.appendChild(o); o.querySelector('#cp-back').addEventListener('click', () => o.remove());
  }
  function showPrompt() {
    injectCpStyles();
    return new Promise((resolve) => {
      const o = document.createElement('div'); o.className = 'cp-overlay';
      o.innerHTML = `<div class="cp-card" role="dialog" aria-modal="true" aria-labelledby="cp-title"><h3 id="cp-title" class="cp-title">Contraseña de control</h3><p class="cp-sub">Requiere autorización.</p><input id="cp-pass" class="cp-input" type="password" placeholder="Contraseña"/><div class="cp-err" id="cp-err"></div><div class="cp-actions"><button class="cp-btn" id="cp-cancel">Cancelar</button><button class="cp-btn primary" id="cp-ok">Ingresar</button></div></div>`;
      document.body.appendChild(o); const $pass = o.querySelector('#cp-pass'); const $err = o.querySelector('#cp-err');
      async function submit() {
        const pass = ($pass.value || '').trim(); if (!pass) { $err.textContent = 'Ingrese contraseña'; return; } $err.textContent = '';
        try {
          const r = await fetch('/api/control/validate', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass }) });
          const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.message || 'Error');
          sessionStorage.setItem('csf_ctrl', '1'); o.remove(); resolve(true);
        } catch (e) { $err.textContent = e?.message || 'Contraseña inválida'; }
      }
      o.querySelector('#cp-ok').addEventListener('click', submit); o.querySelector('#cp-cancel').addEventListener('click', () => { o.remove(); resolve(false); });
      $pass.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); }); setTimeout(() => $pass.focus(), 0);
    });
  }
  async function getStatus() {
    const r = await fetch('/api/control/status', { credentials: 'include' });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j?.message || 'Error estado'); return j;
  }
  async function handleGoMaquinas() {
    try {
      const st = await getStatus(); if (!st.hasControlPass) { showDeny('No posee permisos.'); return; }
      if (st.active || sessionStorage.getItem('csf_ctrl') === '1') { location.href = '/maquinas'; return; }
      const ok = await showPrompt(); if (ok) location.href = '/maquinas';
    } catch (e) { showDeny(e?.message || 'No fue posible validar.'); }
  }
  function wireMenu() {
    const link = document.querySelector('a.menu-item[href="/maquinas"]');
    if (!link) return;
    link.addEventListener('click', (ev) => { ev.preventDefault(); handleGoMaquinas(); }, { capture: true });
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', wireMenu); }
  else { wireMenu(); }
})();

// ====================== GRÁFICO BARRAS (C. temporada) con APEXCHARTS ======================
const btnToggleChart = document.getElementById('btnToggleChart');
const btnHideChart = document.getElementById('btnHideChart');
const chartCard = document.getElementById('chartCard');
const chartContainer = document.getElementById('machinesBarChart');
let machinesChart = null;

function getSeasonFromRow(tr) {
  const ds = tr.dataset.season;
  if (ds !== null && ds !== undefined && ds !== '') {
    const num = Number(ds);
    if (Number.isFinite(num)) return num;
  }
  const txt = tr.querySelector('.td-season')?.textContent ?? '';
  const num = Number(String(txt).replace(/\./g, '').replace(/[^0-9\-]/g, ''));
  return Number.isFinite(num) ? num : null;
}

function getChartDataFromTable() {
  const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => tr.style.display !== 'none');
  const labels = [];
  const values = [];
  const meta = [];

  for (const tr of rows) {
    const name = tr.querySelector('td:first-child')?.textContent?.trim() || '-';
    const season = getSeasonFromRow(tr);
    if (!season || !Number.isFinite(season) || season === 0) continue;

    const estadoText = tr.querySelector('.td-estado')?.textContent?.trim() || '—';
    const onlineText = tr.querySelector('.td-online')?.textContent?.trim() || '—';
    const tipo = tr.querySelector('.td-type')?.textContent?.trim() || '—';
    const empresa = tr.querySelector('.td-company')?.textContent?.trim() || '—';
    const prestador = tr.querySelector('.td-provider')?.textContent?.trim() || '—';
    const fInicio = tr.querySelector('.td-startdate')?.textContent?.trim() || '—';

    labels.push(name);
    values.push(Math.trunc(season));
    meta.push({ empresa, prestador, fInicio, tipo, estado: estadoText, conexion: onlineText });
  }
  return { labels, values, meta };
}

let emptyMsgEl = null;
function showEmptyChartMessage(show) {
  if (!chartCard) return;
  if (!emptyMsgEl) {
    emptyMsgEl = document.createElement('div');
    emptyMsgEl.style.position = 'absolute';
    emptyMsgEl.style.inset = '0';
    emptyMsgEl.style.display = 'grid';
    emptyMsgEl.style.placeItems = 'center';
    emptyMsgEl.style.pointerEvents = 'none';
    emptyMsgEl.style.fontWeight = '600';
    emptyMsgEl.style.color = 'rgba(255, 255, 255, .7)';
    emptyMsgEl.textContent = 'Sin datos visibles (C. temporada > 0)';
    emptyMsgEl.style.opacity = '0';
    emptyMsgEl.style.transition = 'opacity .2s';
    chartCard.style.position = 'relative';
    const wrap = chartCard.querySelector('.chart-wrap');
    if (wrap) {
      wrap.style.position = 'relative';
      wrap.appendChild(emptyMsgEl);
    }
  }
  emptyMsgEl.style.opacity = show ? '1' : '0';
}

function renderMachinesChart() {
  if (!chartContainer) return;
  const { labels, values, meta } = getChartDataFromTable();

  const noRows = labels.length === 0;
  showEmptyChartMessage(noRows);

  if (machinesChart) {
    machinesChart.destroy();
    machinesChart = null;
  }
  if (noRows) {
    chartContainer.innerHTML = '';
    return;
  }

  const options = {
    series: [{ name: 'C. temporada', data: values }],
    colors: ['#0066fe'],
    chart: { type: 'bar', height: '100%', toolbar: { show: false }, animations: { enabled: false } },
    theme: { mode: 'dark' },
    grid: { borderColor: 'rgba(255, 255, 255, 0.1)' },
    plotOptions: { bar: { horizontal: false, dataLabels: { position: 'top' } } },
    dataLabels: {
      enabled: true, offsetY: -20, style: { fontSize: '12px', colors: ['#FFF'] },
      formatter: (val) => nfES.format(Math.trunc(val))
    },
    xaxis: { categories: labels, labels: { style: { colors: '#c6cfdd' } } },
    yaxis: { labels: { style: { colors: '#c6cfdd' }, formatter: (val) => nfES.format(Math.trunc(val)) } },
    tooltip: {
      theme: 'dark',
      x: { show: false }, y: { show: false }, marker: { show: false },
      custom: ({ series, seriesIndex, dataPointIndex, w }) => {
        const m = (meta && meta[dataPointIndex]) || {};
        const val = series?.[seriesIndex]?.[dataPointIndex];
        const valFmt = nfES.format(Math.trunc(val ?? 0));
        const name = w?.globals?.labels?.[dataPointIndex] || labels?.[dataPointIndex] || '—';
        return `
<div class="csf-apex-tip">
  <div class="tip-head">${name}</div>
  <div class="tip-row"><b>C. temporada:</b> <span>${valFmt}</span></div>
  <div class="tip-row"><b>Tipo:</b> <span>${m.tipo ?? '—'}</span></div>
  <div class="tip-row"><b>Empresa:</b> <span>${m.empresa ?? '—'}</span></div>
  <div class="tip-row"><b>Prestador:</b> <span>${m.prestador ?? '—'}</span></div>
  <div class="tip-row"><b>Fecha inicio:</b> <span>${m.fInicio ?? '—'}</span></div>
  <div class="tip-row"><b>Estado:</b> <span>${m.estado ?? '—'}</span></div>
  <div class="tip-row"><b>Conexión:</b> <span>${m.conexion ?? '—'}</span></div>
</div>`;
      }
    }
  };

  const chart = new ApexCharts(chartContainer, options);
  machinesChart = chart;
  chart.render();
}

function showChartCard(show) {
  const wantShow = !!show;
  chartCard.classList.toggle('hidden', !wantShow);
  const expanded = wantShow ? 'true' : 'false';
  btnToggleChart?.setAttribute('aria-expanded', expanded);
  if (wantShow) {
    renderMachinesChart();
    setTimeout(() => {
      chartCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }
}
function refreshChartIfVisible() {
  if (!chartCard || chartCard.classList.contains('hidden')) return;
  renderMachinesChart();
}
btnToggleChart?.addEventListener('click', () => {
  const willShow = chartCard.classList.contains('hidden');
  showChartCard(willShow);
  btnToggleChart.textContent = willShow ? 'Ocultar gráfico' : 'Mostrar gráfico';
});
btnHideChart?.addEventListener('click', () => {
  showChartCard(false);
  btnToggleChart.textContent = 'Mostrar gráfico';
});

// === Chips "Máquinas visibles" (dinámicos por filtros y RT) ===
(function () {
  const tbody = document.getElementById('boxesTbody');
  const chipsWrap = document.getElementById('kpiChips');

  const chipOperativoB  = document.querySelector('#chipOperativo b');
  const chipEmergenciaB = document.querySelector('#chipEmergencia b');
  const chipLadoAB      = document.querySelector('#chipLadoA b');
  const chipLadoBB      = document.querySelector('#chipLadoB b');
  const chipOfflineRoot = document.getElementById('chipOffline');
  const chipOfflineB    = chipOfflineRoot?.querySelector('b');

  const searchInput   = document.getElementById('searchBox');
  const statusSelect  = document.getElementById('filterConn');     // Conexión
  const stateSelect   = document.getElementById('filterState');    // Estado
  const typeSelect    = document.getElementById('filterType');
  const companySelect = document.getElementById('filterCompany');
  const providerSelect= document.getElementById('filterProvider');

  // Contenedor para chips "informativos" de filtros
  let extraChipsBox = null;
  function ensureExtraChipsBox() {
    if (extraChipsBox) return extraChipsBox;
    extraChipsBox = document.createElement('span');
    extraChipsBox.className = 'kpi-chips-inline';
    chipsWrap?.appendChild(extraChipsBox);
    return extraChipsBox;
  }

  function anyFilterActive() {
    return !!(
      (searchInput && searchInput.value.trim()) ||
      (statusSelect && statusSelect.value) ||
      (stateSelect && stateSelect.value) ||
      (typeSelect && typeSelect.value) ||
      (companySelect && companySelect.value) ||
      (providerSelect && providerSelect.value)
    );
  }

  function bucketFromFlags(flags) {
    const a = Number(flags?.ladoA) === 1;
    const b = Number(flags?.ladoB) === 1;
    const emer = Number(flags?.emergencia) === 1;
    const func = Number(flags?.funcionando) === 1;
    if (emer) return 'emergencia';
    if (a && b) return 'full';
    if (a && !b) return 'ladoA';
    if (b && !a) return 'ladoB';
    if (func) return 'operativo';
    return 'sin';
  }

  function isRowOnline(tr) {
    const onlineText = tr.querySelector('.td-online')?.textContent?.toLowerCase() || '';
    return onlineText.includes('en línea') || onlineText.includes('en linea');
  }

  function renderFilterChips() {
    const box = ensureExtraChipsBox();
    box.innerHTML = '';

    const chips = [];
    if (typeSelect?.value)    chips.push({ label: `Tipo: ${typeSelect.options[typeSelect.selectedIndex].text}` });
    if (companySelect?.value) chips.push({ label: `Empresa: ${companySelect.options[companySelect.selectedIndex].text}` });
    if (providerSelect?.value)chips.push({ label: `Prestador: ${providerSelect.options[providerSelect.selectedIndex].text}` });
    if (searchInput?.value.trim()) chips.push({ label: `Búsqueda: “${searchInput.value.trim()}”` });

    for (const c of chips) {
      const s = document.createElement('span');
      s.className = 'kpi-chip chip-info';
      s.textContent = c.label;
      box.appendChild(s);
    }
    box.classList.toggle('hidden', chips.length === 0);
  }

  function updateKpiChips() {
    if (!tbody || !chipsWrap) return;

    const show = anyFilterActive();
    chipsWrap.classList.toggle('hidden', !show);
    if (!show) return;

    let cOperativo = 0, cEmerg = 0, cA = 0, cB = 0, cOffline = 0, cSinOp = 0;

    const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => tr.style.display !== 'none');
    for (const tr of rows) {
      const flags = tr._flags || {};
      const bucket = bucketFromFlags(flags);
      const online = isRowOnline(tr);

      if (!online) cOffline++;
      if (bucket === 'emergencia') cEmerg++;
      else if (bucket === 'ladoA') cA++;
      else if (bucket === 'ladoB') cB++;
      else if (bucket === 'operativo' || bucket === 'full') cOperativo++;
      else if (bucket === 'sin') cSinOp++;
    }

    // Si Conexión=En línea, el chip derecho cambia a "Sin operación"
    const onLineFilter = (statusSelect?.value === '1');
    if (chipOfflineRoot) {
      chipOfflineRoot.firstChild.textContent = onLineFilter ? 'Sin operación: ' : 'Fuera de línea: ';
    }
    if (chipOfflineB) {
      chipOfflineB.textContent = onLineFilter ? cSinOp : cOffline;
    }

    if (chipOperativoB)  chipOperativoB.textContent  = cOperativo;
    if (chipEmergenciaB) chipEmergenciaB.textContent = cEmerg;
    if (chipLadoAB)      chipLadoAB.textContent      = cA;
    if (chipLadoBB)      chipLadoBB.textContent      = cB;

    renderFilterChips();
  }

  [searchInput, statusSelect, stateSelect, typeSelect, companySelect, providerSelect].forEach(el => {
    if (!el) return;
    el.addEventListener('input',  updateKpiChips);
    el.addEventListener('change', updateKpiChips);
  });

  if (tbody) {
    const mo = new MutationObserver(() => updateKpiChips());
    mo.observe(tbody, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'data-season'] });
  }

  document.addEventListener('DOMContentLoaded', updateKpiChips);
  setInterval(() => { if (anyFilterActive()) updateKpiChips(); }, 1200);

  window.__updateKpiChips = updateKpiChips;
})();
