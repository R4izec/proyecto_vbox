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

// --- MODAL LOGOUT ---
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
    try { await fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch {}
    try { localStorage.removeItem('vbox_sid'); } catch {}
    try { sessionStorage.clear(); } catch {}
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
function showToast(message, timeout = TOAST_MS) {
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
  requestAnimationFrame(() => toast.classList.add('show'));
  if (timeout > 0) setTimeout(() => toast.classList.remove('show'), timeout);
}
(function welcomeOnce(){
  if (sessionStorage.getItem('welcomed_e')) return;
  const u = JSON.parse(sessionStorage.getItem('user') || '{}');
  showToast(`Bienvenido, ${(u?.username || 'usuario')}`, TOAST_MS);
  sessionStorage.setItem('welcomed_e','1');
})();

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
const chipA = document.getElementById('chipLadoA');
const chipB = document.getElementById('chipLadoB');

const nfES = new Intl.NumberFormat('es-CL');

// ======= Totales =======
let totalSeasonLast = 0, machinesVisibleLast = 0;
function animateNumber(el, from, to, dur = 600) {
  if (!el) return;
  if (from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
    el.textContent = Number.isFinite(to) ? nfES.format(Math.trunc(to)) : '—';
    return;
  }
  const start = performance.now();
  const id = Symbol('anim');
  el._anim = id;
  function step(t) {
    if (el._anim !== id) return;
    const p = Math.min(1, (t - start) / dur);
    el.textContent = nfES.format(Math.round(from + (to - from) * p));
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function setTotalSeasonValue(n){ animateNumber(totalSeasonEl, totalSeasonLast||0, n||0); totalSeasonLast=n||0; }
function setMachinesVisibleValue(n){ animateNumber(machinesVisibleEl, machinesVisibleLast||0, n||0); machinesVisibleLast=n||0; }
function recalcTotalsNow() {
  const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => tr.style.display !== 'none');
  let sum = 0;
  for (const tr of rows) {
    const v = Number(tr.dataset.season);
    if (Number.isFinite(v)) sum += v;
  }
  setTotalSeasonValue(sum);
  setMachinesVisibleValue(rows.length);
}
let _recalcTick; const scheduleTotals = ()=>{ clearTimeout(_recalcTick); _recalcTick=setTimeout(recalcTotalsNow,60); };

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
const initialsByName = new Map(), initialsByNum = new Map();
function extractNumKey(name) { return (String(name || '').match(/\d+/)?.[0] || '').trim(); }
function getInitialForMachine(name) {
  const k1 = String(name || '').toLowerCase();
  const k2 = extractNumKey(name);
  if (initialsByName.has(k1)) return initialsByName.get(k1);
  if (k2 && initialsByNum.has(k2)) return initialsByNum.get(k2);
  return null;
}

// Metadatos por máquina
const typeByName = new Map();
const companyByName = new Map();
const providerByName = new Map();
const startDateByName = new Map();

// Carga de metadatos (NO llena selects aquí)
async function loadExtraMachineData() {
  const res = await fetch(API_MACHINES, { credentials: 'include', headers: { 'x-vbox-sid': sid || '' } });
  if (!res.ok) throw new Error(`Error ${res.status} al cargar ${API_MACHINES}`);
  const { list = [] } = await res.json();
  typeByName.clear(); companyByName.clear(); providerByName.clear(); startDateByName.clear();
  for (const m of list) {
    const k = String(m.machineName || '').toLowerCase();
    if (!k) continue;
    if (m.type)      typeByName.set(k, (m.type||'').trim());
    if (m.company)   companyByName.set(k, (m.company||'').trim());
    if (m.provider)  providerByName.set(k, (m.provider||'').trim());
    if (m.startDate) startDateByName.set(k, m.startDate);
  }
}

// ========= BADGES / FORMAT =========
const DOWN_TOLERANCE = 5000;
function badgeOnline(v){const on=Number(v)===1;return `<span class="badge ${on?'success':'neutral'}">${on?'En línea':'Fuera de línea'}</span>`;}
function badgeEstadoFromFlags({ funcionando=null, emergencia=null, ladoA=0, ladoB=0 } = {}) {
  const a=+ladoA===1,b=+ladoB===1,emer=+emergencia===1,func=+funcionando===1;
  if (emer) return `<span class="badge danger">Emergencia</span>`;
  if (a&&b) return `<span class="badge success">Operativo completo</span>`;
  if (a&&!b) return `<span class="badge warning">Operativo lado A</span>`;
  if (b&&!a) return `<span class="badge warning">Operativo lado B</span>`;
  if (func) return `<span class="badge success">Operativo</span>`;
  return `<span class="badge neutral">Sin Operación</span>`;
}
function fmtInt(n){return (n==null||!Number.isFinite(n))?'—':nfES.format(Math.trunc(n));}
function fmtDate(v){ try{ const d=new Date(v); if(isNaN(d))return'—'; const y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0'),dd=String(d.getUTCDate()).padStart(2,'0'); return `${y}-${m}-${dd}`;}catch{return'—';}}

// ===== rowSkeleton =====
function rowSkeleton(box) {
  const key = (box.boxName || '').toLowerCase();
  const tipo = typeByName.get(key) || '—';
  const comp = companyByName.get(key) || '—';
  const prov = providerByName.get(key) || '—';
  const startDateFmt = fmtDate(startDateByName.get(key));
  return `
<tr data-box-id="${box.boxId}" data-name="${key}" data-season=""
  data-type="${(tipo || '').toLowerCase()}"
  data-company="${(comp || '').toLowerCase()}"
  data-provider="${(prov || '').toLowerCase()}"
  data-startdate="${startDateFmt==='—'?'':startDateFmt}">
  <td>${box.boxName || '-'}</td>
  <td class="td-type">${tipo}</td>
  <td class="td-company">${comp}</td>
  <td class="td-provider">${prov}</td>
  <td class="td-startdate">${startDateFmt}</td>
  <td class="td-season"><span class="skel"></span></td>
  <td class="td-online">${badgeOnline(box.state)}</td>
  <td class="td-estado"><span class="skel"></span></td>
</tr>`;
}

/* ===== filtros ===== */
function normalized(s){ return (s||'').toString().trim().toLowerCase().replace(/[-_]/g,' ').replace(/\s+/g,' '); }
const searchInput   = document.getElementById('searchBox');
const statusSelect  = document.getElementById('filterConn');
const stateSelect   = document.getElementById('filterState');
const typeSelect    = document.getElementById('filterType');
const companySelect = document.getElementById('filterCompany');
const providerSelect= document.getElementById('filterProvider');

function matchesName(box, q){
  if (!q) return true;
  const name = box.boxName || '';
  const target = normalized(name) + ' ' + name.replace(/\D/g, '');
  const num = name.match(/\d+/)?.[0] || '';
  return target.includes(q) || (!!num && num.includes(q.replace(/\D/g,'')));
}

function estadoBucket(flags){
  const a=+flags?.ladoA===1,b=+flags?.ladoB===1,emer=+flags?.emergencia===1,func=+flags?.funcionando===1;
  if (emer) return 'emergencia';
  if (a&&b) return 'full';
  if (a&&!b) return 'ladoA';
  if (b&&!a) return 'ladoB';
  if (func) return 'operativo';
  return 'sin';
}

const onlineById = new Map();
function setOnlineState(id,state){ onlineById.set(String(id), String(state)); }
function getOnlineState(id,fallback){ const v=onlineById.get(String(id)); return v!=null?v:String(fallback); }

// === Poblado dinámico de selects usando SOLO lo que está en la tabla ===
function fillSelect(el, values, firstLabel){
  if (!el) return;
  const arr = Array.from(values).filter(Boolean).sort((a,b)=>a.localeCompare(b));
  el.innerHTML = `<option value="">${firstLabel}</option>` + arr.map(v=>`<option value="${v}">${v}</option>`).join('');
}
function populateSelectsFromTable() {
  const rows = Array.from(tbody.querySelectorAll('tr[data-box-id]'));
  const types = new Set(), companies = new Set(), providers = new Set();
  for (const tr of rows) {
    const t = tr.querySelector('.td-type')?.textContent?.trim(); if (t) types.add(t);
    const c = tr.querySelector('.td-company')?.textContent?.trim(); if (c) companies.add(c);
    const p = tr.querySelector('.td-provider')?.textContent?.trim(); if (p) providers.add(p);
  }
  fillSelect(typeSelect, types, 'Todos');
  fillSelect(companySelect, companies, 'Todas');
  fillSelect(providerSelect, providers, 'Todos');
}

function updateDobleChipsVisibility() {
  const visibleRows = Array.from(tbody.querySelectorAll('tr')).filter(tr => tr.style.display !== 'none');
  const hasDoble = visibleRows.some(tr => (tr.querySelector('.td-type')?.textContent || '').toUpperCase() === 'CSF-DOBLE');
  chipA?.classList.toggle('hidden', !hasDoble);
  chipB?.classList.toggle('hidden', !hasDoble);
}

function applyFilters() {
  const q = normalized(searchInput?.value || '');
  const wantStat = statusSelect?.value ?? '';
  const wantEst = stateSelect?.value ?? '';
  const wantType = typeSelect?.value || '';
  const wantComp = companySelect?.value || '';
  const wantProv = providerSelect?.value || '';

  const operativoGroup = new Set(['operativo','full','ladoA','ladoB']);

  for (const tr of Array.from(tbody.querySelectorAll('tr'))) {
    const id = tr.getAttribute('data-box-id');
    const nameCell = tr.querySelector('td:first-child')?.textContent || '';
    const box = { boxId: id, boxName: nameCell };

    const nameOk = matchesName(box, q);

    const connNow = getOnlineState(id, tr.querySelector('.td-online')?.textContent?.includes('En línea') ? '1':'0');
    let connRequired = wantStat;
    if (!connRequired && wantEst) connRequired = '1';
    const statOk = !connRequired || (String(connNow) === String(connRequired));

    const flags = tr._flags || {};
    const bucket = estadoBucket(flags);
    let estOk = true;
    if (wantEst) {
      if (wantEst === 'operativo') estOk = operativoGroup.has(bucket);
      else estOk = (bucket === wantEst);
    }

    const tipo  = tr.querySelector('.td-type')?.textContent || '';
    const comp  = tr.querySelector('.td-company')?.textContent || '';
    const prov  = tr.querySelector('.td-provider')?.textContent || '';
    const typeOk = !wantType || (tipo === wantType);
    const compOk = !wantComp || (comp === wantComp);
    const provOk = !wantProv || (prov === wantProv);

    tr.style.display = (nameOk && statOk && estOk && typeOk && compOk && provOk) ? '' : 'none';
  }

  scheduleTotals();
  refreshChartIfVisible();
  updateDobleChipsVisibility();
}

let filterTick;
function debouncedFilter(){ clearTimeout(filterTick); filterTick=setTimeout(()=>{ applyFilters(); applySort(); },100); }
[searchInput, statusSelect, stateSelect, typeSelect, companySelect, providerSelect].forEach(el=>{
  if (el) { el.addEventListener('input', debouncedFilter); el.addEventListener('change', debouncedFilter); }
});

// ======= UPDATE ROWS =======
function getRowByBoxId(boxId){ return tbody?.querySelector(`tr[data-box-id="${boxId}"]`) || null; }
function readSeasonFromRow(tr){ const raw=tr?.dataset?.season; const n=Number(raw); return Number.isFinite(n)?n:null; }
function writeSeasonToRow(tr, season){
  const cell = tr.querySelector('.td-season');
  if (season==null || !Number.isFinite(season)) return;
  const prev = readSeasonFromRow(tr);
  const next = (prev!=null && season + DOWN_TOLERANCE < prev) ? prev : season;
  if (cell) cell.textContent = fmtInt(next);
  tr.dataset.season = String(Math.trunc(next));
}
function updateRow(boxId, { season=undefined, funcionando=null, emergencia=null, ladoA=0, ladoB=0 } = {}) {
  const tr = getRowByBoxId(boxId);
  if (!tr) return;
  if (season !== undefined) {
    if (season!=null && Number.isFinite(Number(season))) writeSeasonToRow(tr, Number(season));
  }
  const estadoCell = tr.querySelector('.td-estado');
  if (estadoCell) estadoCell.innerHTML = badgeEstadoFromFlags({ funcionando, emergencia, ladoA, ladoB });
  tr._flags = { funcionando, emergencia, ladoA, ladoB };
}
function updateOnline(boxId, state){
  const tr = getRowByBoxId(boxId);
  if (!tr) return;
  const onlineCell = tr.querySelector('.td-online');
  if (onlineCell) onlineCell.innerHTML = badgeOnline(state);
  setOnlineState(boxId, state);
}

// ========= QUEUE & AUTO-REFRESH =========
class Queue {
  constructor(worker, concurrency=4){ this.worker=worker; this.concurrency=concurrency; this.queue=[]; this.running=0; }
  push(item, priority=false){ if (priority) this.queue.unshift(item); else this.queue.push(item); this._run(); }
  _run(){ while(this.running<this.concurrency && this.queue.length){ const it=this.queue.shift(); this.running++; Promise.resolve().then(()=>this.worker(it)).catch(console.error).finally(()=>{this.running--; this._run();}); } }
  clear(){ this.queue.length=0; }
}

const viewport = document.querySelector('.table-viewport') || document;
const visibleSet = new Set();
const io = new IntersectionObserver(entries=>{
  entries.forEach(e=>{
    const tr=e.target; const id=tr.getAttribute('data-box-id'); if (!id) return;
    if (e.isIntersecting) visibleSet.add(id); else visibleSet.delete(id);
  });
},{ root: viewport===document?null:viewport, threshold: 0.01 });

const REFRESH_MS = 20000;
const ONLINE_REFRESH_MS = 10000;
let refreshInterval=null, onlineInterval=null;

let items = [];
const tagNameMem = new Map();

const qTag = new Queue(async (b) => {
  try {
    const cfg = await api(`${API}/tagcfg`, { boxId: b.boxId });
    const t = cfg.tags || {};
    const theList = [t.contador?.name, t.funcionando?.name, t.emergencia?.name, t.ladoA?.name, t.ladoB?.name].filter(Boolean);
    tagNameMem.set(b.boxId, theList.length ? theList : DEFAULT_NAMES);
  } catch {
    tagNameMem.set(b.boxId, DEFAULT_NAMES);
  }
}, 4);

const qRT = new Queue(async (b)=>{
  try{
    const names = tagNameMem.get(b.boxId) || DEFAULT_NAMES;
    const rt = await api(`${API}/realtime`, { boxId: b.boxId, names: names.join(',') });
    const init = getInitialForMachine(b.boxName);
    const contadorNum = (rt?.contador!=null && !isNaN(Number(rt.contador))) ? Number(rt.contador) : null;
    let seasonCalc;
    if (init!=null && Number.isFinite(init) && contadorNum!=null && Number.isFinite(contadorNum)) {
      seasonCalc = Math.max(0, contadorNum - init);
      const tr = getRowByBoxId(b.boxId);
      if (tr) {
        const prev = readSeasonFromRow(tr);
        if (prev!=null && seasonCalc + DOWN_TOLERANCE < prev) seasonCalc = prev;
      }
    } else {
      seasonCalc = undefined;
    }
    updateRow(b.boxId, { season: seasonCalc, funcionando: rt?.funcionando??null, emergencia: rt?.emergencia??null, ladoA: rt?.ladoA??0, ladoB: rt?.ladoB??0 });
  } catch (e){
    console.error(`RT error for ${b.boxId}:`, e);
    updateRow(b.boxId, { season: undefined, funcionando: null, emergencia: null, ladoA: 0, ladoB: 0 });
  } finally {
    scheduleTotals();
    refreshChartIfVisible();
  }
}, 8);

async function scheduleRealtimeCycle(){
  if (!items.length) return;
  const visibleIds = Array.from(visibleSet);
  items.forEach(b => qRT.push(b, visibleIds.includes(String(b.boxId))));
}
async function refreshOnlineBadges(){
  try{
    const data = await api(`${API}/boxes`);
    const latest = flattenBoxList(data);
    latest.forEach(b => updateOnline(b.boxId, b.state));
    applyFilters();
  } catch(e){ console.error('refreshOnlineBadges:', e); }
}
function startAutoRefresh(){ stopAutoRefresh(); refreshInterval=setInterval(scheduleRealtimeCycle, REFRESH_MS); onlineInterval=setInterval(refreshOnlineBadges, ONLINE_REFRESH_MS); }
function stopAutoRefresh(){ if (refreshInterval) clearInterval(refreshInterval), (refreshInterval=null); if (onlineInterval) clearInterval(onlineInterval), (onlineInterval=null); qTag.clear(); qRT.clear(); }
document.addEventListener('visibilitychange', ()=>{ if (document.hidden) stopAutoRefresh(); else { scheduleRealtimeCycle(); refreshOnlineBadges(); startAutoRefresh(); }});

function flattenBoxList(data){
  const groups = data?.result?.list || data?.list || [];
  const rows = [];
  for (const g of groups) for (const b of (g.boxList || [])) rows.push(b);
  return rows;
}

// ==== ORDENAR =====
let currentSort = { key: 'season', dir: 'desc' };
const sortBtns = document.querySelectorAll('.sort');
sortBtns.forEach(btn=>{
  btn.addEventListener('click', ()=>{
    const key = btn.dataset.key;
    if (currentSort.key !== key) currentSort = { key, dir: 'desc' };
    else if (currentSort.dir === 'desc') currentSort.dir = 'asc';
    else if (currentSort.dir === 'asc') currentSort = { key: '', dir: '' };
    sortBtns.forEach(b => b.classList.remove('active','asc','desc'));
    if (currentSort.key && currentSort.dir) {
      const b = document.querySelector(`.sort[data-key="${currentSort.key}"]`);
      b?.classList.add('active', currentSort.dir);
    }
    applySort();
  });
});
function applySort(){
  const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => tr.style.display !== 'none');
  if (!currentSort.key || !currentSort.dir) {
    rows.sort((a,b)=>(a.dataset.name||'').localeCompare(b.dataset.name||''));
  } else {
    const k=currentSort.key, dirMul=currentSort.dir==='asc'?1:-1;
    const valFor=(tr)=>{ const v=Number(tr.dataset[k]); if (Number.isFinite(v)) return v; return currentSort.dir==='asc'?Infinity:-Infinity; };
    rows.sort((a,b)=>(valFor(a)-valFor(b))*dirMul);
  }
  rows.forEach(tr=>tbody.appendChild(tr));
  scheduleTotals();
  refreshChartIfVisible();
}

// ========= CARGA INICIAL =========
async function getBoxes(){ return api(`${API}/boxes`); }
async function loadTable(){
  try{
    if (!sid) { tbody.innerHTML = `<tr><td colspan="8">No hay sesión de V-BOX (sid). Inicia sesión nuevamente.</td></tr>`; return; }

    tbody.innerHTML = `<tr class="loading-row"><td colspan="8"><div class="loader"><span class="ring"></span> Cargando datos...</div></td></tr>`;

    await loadExtraMachineData();

    // initial counters
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
    } catch {
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
      } catch {}
    }

    const data = await getBoxes();
    items = flattenBoxList(data);
    if (!items.length) { tbody.innerHTML = `<tr><td colspan="8">No hay máquinas disponibles en VBox.</td></tr>`; return; }

    items.forEach(b => setOnlineState(b.boxId, b.state));

    tbody.innerHTML = items.map(rowSkeleton).join('');
    [...tbody.querySelectorAll('tr[data-box-id]')].forEach(tr => io.observe(tr));

    // AHORA: llenar selects SOLO con lo que quedó en la tabla
    populateSelectsFromTable();

    // Preparar chips A/B según existencia de CSF-DOBLE en la tabla completa
    updateDobleChipsVisibility();

    items.forEach(b => qTag.push(b, true));
    await sleep(200);
    await scheduleRealtimeCycle();
    refreshOnlineBadges();
    startAutoRefresh();

    applyFilters();
    applySort();
  } catch (err){
    console.error("Error fatal en loadTable:", err);
    tbody.innerHTML = `<tr><td colspan="8">Error cargando datos: ${err.message}</td></tr>`;
  }
}

// ====== CLICK fila -> Históricos ======
tbody?.addEventListener('click', (e)=>{
  const tr = e.target.closest('tr[data-box-id]'); if (!tr) return;
  const machineName = tr.querySelector('td:first-child')?.textContent?.trim();
  const startDateValue = tr.dataset.startdate;
  if (!machineName) return;
  const endDateValue = fmtDate(new Date());
  const params = new URLSearchParams({ machine: machineName, start: startDateValue || '', end: endDateValue, auto: 'true' });
  window.open(`/historicos/historicos.html?${params.toString()}`, '_blank');
});

ensureLogged().then(loadTable);

// ====== EXPORTAR EXCEL ======
const exportBtn = document.getElementById('btnExport');
const btnSpinner = document.querySelector('#btnExport .spinner');
const btnText = document.querySelector('#btnExport .btn-text');
function setBtnLoading(l){ if (!exportBtn) return; exportBtn.disabled=l; if(btnSpinner) btnSpinner.classList.toggle('hidden',!l); if(btnText) btnText.textContent=l?'Generando…':'Descargar Datos'; }

async function downloadExcel(){
  try{
    setBtnLoading(true);
    showToast('Generando informe…', 2500);
    const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr => tr.style.display !== 'none');
    const boxIds = rows.map(tr => tr.getAttribute('data-box-id')).filter(Boolean);
    if (!boxIds.length) { showToast('No hay máquinas visibles para exportar.', 3000); return; }
    const resp = await fetch('/api/monitor/export.xlsx', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-vbox-sid': sid || '' },
      body: JSON.stringify({ boxIds })
    });
    if (!resp.ok) {
      const j = await resp.json().catch(()=>({ message:`Error ${resp.status}` }));
      throw new Error(j.message || `Error ${resp.status} al generar Excel`);
    }
    const blob = await resp.blob();
    if (blob.type === 'application/json') {
      const errorJson = JSON.parse(await blob.text());
      throw new Error(errorJson.message || 'Error del servidor al generar Excel');
    }
    const url = URL.createObjectURL(blob);
    const d=new Date(), pad2=(n)=>String(n).padStart(2,'0');
    const fname=`datos_maquinas_${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}.xlsx`;
    const a=document.createElement('a'); a.href=url; a.download=fname; document.body.appendChild(a); a.click();
    setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); },100);
    showToast('Excel descargado', 2400);
  } catch(e){ console.error('downloadExcel:', e); showToast(e.message||'Error al descargar', 3500); }
  finally{ setBtnLoading(false); }
}
exportBtn?.addEventListener('click', downloadExcel);

// ====================== GRÁFICO (ApexCharts) ======================
const btnToggleChart = document.getElementById('btnToggleChart');
const btnHideChart = document.getElementById('btnHideChart');
const chartCard = document.getElementById('chartCard');
const chartContainer = document.getElementById('machinesBarChart');
let machinesChart = null;

function getSeasonFromRow(tr){
  const ds = tr.dataset.season;
  if (ds!==null && ds!==undefined && ds!==''){ const num=Number(ds); if (Number.isFinite(num)) return num; }
  const txt = tr.querySelector('.td-season')?.textContent ?? '';
  const num = Number(String(txt).replace(/\./g,'').replace(/[^0-9\-]/g,''));
  return Number.isFinite(num) ? num : null;
}

function getChartDataFromTable(){
  const rows = Array.from(tbody.querySelectorAll('tr')).filter(tr=>tr.style.display!=='none');
  const labels=[], values=[], meta=[];
  for (const tr of rows){
    const name = tr.querySelector('td:first-child')?.textContent?.trim() || '-';
    const season = getSeasonFromRow(tr);
    if (!Number.isFinite(season) || season===0) continue;
    const tipo = tr.querySelector('.td-type')?.textContent?.trim() || '—';
    const empresa = tr.querySelector('.td-company')?.textContent?.trim() || '—';
    const prestador = tr.querySelector('.td-provider')?.textContent?.trim() || '—';
    const fInicio = tr.querySelector('.td-startdate')?.textContent?.trim() || '—';
    const estadoText = tr.querySelector('.td-estado')?.textContent?.trim() || '—';
    const onlineText = tr.querySelector('.td-online')?.textContent?.trim() || '—';
    labels.push(name); values.push(Math.trunc(season));
    meta.push({ empresa, prestador, fInicio, tipo, estado: estadoText, conexion: onlineText });
  }
  return { labels, values, meta };
}

let emptyMsgEl=null;
function showEmptyChartMessage(show){
  if (!chartCard) return;
  if (!emptyMsgEl){
    emptyMsgEl=document.createElement('div');
    Object.assign(emptyMsgEl.style,{position:'absolute',inset:'0',display:'grid',placeItems:'center',pointerEvents:'none',fontWeight:'600',color:'rgba(255,255,255,.7)',opacity:'0',transition:'opacity .2s'});
    emptyMsgEl.textContent='Sin datos visibles (C. temporada > 0)';
    chartCard.style.position='relative';
    chartCard.querySelector('.chart-wrap').appendChild(emptyMsgEl);
  }
  emptyMsgEl.style.opacity = show ? '1' : '0';
}

function renderMachinesChart(){
  if (!chartContainer) return;
  const { labels, values, meta } = getChartDataFromTable();
  const noRows = labels.length === 0;
  showEmptyChartMessage(noRows);
  if (machinesChart){ machinesChart.destroy(); machinesChart=null; }
  if (noRows){ chartContainer.innerHTML=''; return; }

  const chart = new ApexCharts(chartContainer, {
    series:[{ name:'C. temporada', data: values }],
    colors:['#0066fe'],
    chart:{ type:'bar', height:'100%', toolbar:{show:false}, animations:{enabled:false}},
    theme:{ mode:'dark' },
    grid:{ borderColor:'rgba(255,255,255,0.1)' },
    plotOptions:{ bar:{ horizontal:false, dataLabels:{ position:'top' } } },
    dataLabels:{ enabled:true, offsetY:-20, style:{ fontSize:'12px', colors:['#FFF'] }, formatter:v=>nfES.format(Math.trunc(v)) },
    xaxis:{ categories: labels, labels:{ style:{ colors:'#c6cfdd' } } },
    yaxis:{ labels:{ style:{ colors:'#c6cfdd' }, formatter:v=>nfES.format(Math.trunc(v)) } },
    tooltip:{
      theme:'dark', x:{show:false}, y:{show:false}, marker:{show:false},
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
  });
  machinesChart = chart;
  chart.render();
}

function showChartCard(show){
  const want = !!show;
  chartCard.classList.toggle('hidden', !want);
  document.getElementById('btnToggleChart')?.setAttribute('aria-expanded', want?'true':'false');
  if (want){ renderMachinesChart(); setTimeout(()=>chartCard.scrollIntoView({behavior:'smooth',block:'start'}),50); }
}
function refreshChartIfVisible(){ if (!chartCard || chartCard.classList.contains('hidden')) return; renderMachinesChart(); }
document.getElementById('btnToggleChart')?.addEventListener('click', ()=>{
  const willShow = chartCard.classList.contains('hidden');
  showChartCard(willShow);
  document.getElementById('btnToggleChart').textContent = willShow ? 'Ocultar gráfico' : 'Mostrar gráfico';
});
document.getElementById('btnHideChart')?.addEventListener('click', ()=>{
  showChartCard(false);
  document.getElementById('btnToggleChart').textContent = 'Mostrar gráfico';
});
