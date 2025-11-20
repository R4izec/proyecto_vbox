const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

const API = '/api/maquinas';
const sid = localStorage.getItem('vbox_sid') || '';
const TYPES = ['CSF-DOBLE','PEL-CSF','2023-CSF','2024-CSF'];

/* ===== Sesión ===== */
async function ensureLogged(){
  try{
    const r = await fetch('/api/me', { credentials: 'include' });
    if (!r.ok) throw new Error();
    const { user } = await r.json();
    sessionStorage.setItem('user', JSON.stringify(user));
    return user;
  }catch{
    location.href = '/login';
    throw new Error('No session');
  }
}

/* ===== Gate en /maquinas por acceso directo ===== */
(async function gateOnDirectAccess(){
  try {
    const r = await fetch('/api/control/status', { credentials: 'include' });
    const st = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(st?.message || 'Error');
    if (!st.hasControlPass) {
      alert('Usted no posee permisos para ingresar a esta función. Comuníquese con el administrador.');
      location.href = '/dashboard';
      return;
    }
    if (st.active || sessionStorage.getItem('csf_ctrl') === '1') {
      return;
    }
    const pass = prompt('Ingrese su contraseña de control:');
    if (!pass) { location.href = '/dashboard'; return; }
    const vr = await fetch('/api/control/validate', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass })
    });
    const j = await vr.json().catch(()=>({}));
    if (!vr.ok) throw new Error(j?.message || 'Contraseña inválida');
    sessionStorage.setItem('csf_ctrl', '1');
  } catch (e) {
    alert(e?.message || 'No fue posible validar permisos.');
    location.href = '/dashboard';
  }
})();

/* ===== Menú ===== */
const menuBtn = $('#menuBtn'), menu = $('#userMenu'), logoutBtn = $('#logoutBtn');
function toggleMenu(open){
  const isOpen = typeof open === 'boolean' ? open : !menu.classList.contains('open');
  menu.classList.toggle('open', isOpen);
  menuBtn?.setAttribute('aria-expanded', String(isOpen));
}
menuBtn?.addEventListener('click', ()=>toggleMenu());
document.addEventListener('click',(e)=>{ if (!menu || !menuBtn) return; if (menu.contains(e.target) || menuBtn.contains(e.target)) return; toggleMenu(false); });
document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') toggleMenu(false); });

/* ===== Modal de logout ===== */
let logoutModal;
function ensureLogoutModal() {
  if (logoutModal) return logoutModal;

  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.dataset.kind = 'logout';
  overlay.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="logoutTitle">
      <h3 id="logoutTitle">¿Cerrar sesión?</h3>
      <p>Se cerrará tu sesión actual. Puedes cancelar para seguir en la página.</p>
      <div class="modal-buttons">
        <button type="button" class="cancel">Cancelar</button>
        <button type="button" class="danger confirm">Cerrar sesión</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const open  = () => { overlay.classList.add('open'); document.body.style.overflow = 'hidden'; };
  const close = () => { overlay.classList.remove('open'); document.body.style.overflow = ''; };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => {
    if (overlay.classList.contains('open') && e.key === 'Escape') close();
  });

  overlay.querySelector('.cancel').addEventListener('click', close);

  overlay.querySelector('.confirm').addEventListener('click', async () => {
    const btn = overlay.querySelector('.confirm');
    btn.disabled = true;
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    } catch (_) {
    } finally {
      try { localStorage.removeItem('vbox_sid'); } catch {}
      try { sessionStorage.clear(); } catch {}
      location.replace('/login');
    }
  });

  logoutModal = { open, close, el: overlay };
  return logoutModal;
}
logoutBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  toggleMenu(false);
  ensureLogoutModal().open();
});

/* ===== Toast ===== */
const toastEl = $('.toast');
$('.toast .close').addEventListener('click', ()=> toastEl.classList.remove('show'));
function toast(msg, t=2600){ toastEl.querySelector('.msg').textContent = msg; toastEl.classList.add('show'); if (t>0) setTimeout(()=>toastEl.classList.remove('show'), t); }

/* ===== API helper (cookie) ===== */
async function api(path, opts={}){
  const res = await fetch(path, {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: { 'Content-Type':'application/json', 'x-vbox-sid': sid || '' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const json = await res.json().catch(()=> ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) location.href = '/login';
    throw new Error(json.message || 'Error API');
  }
  return json;
}

/* ===== DOM ===== */
const modeCreate = $('#mode-create');
const modeEdit   = $('#mode-edit');
const searchPane = $('#searchPane');
const machineSearch = $('#machineSearch');
const machineSelect = $('#machineSelect');
const btnLoad   = $('#btnLoad');
const btnDelete = $('#btnDelete');

const frm = $('#frmMachine');
const btnSave = $('#btnSave');
const btnClear = $('#btnClear');
const editId = $('#editId');
const f = {
  machineName: $('#machineName'),

  companyExisting: $('#companyExisting'),
  company:     $('#company'),

  providerExisting: $('#providerExisting'),
  provider:    $('#provider'),

  typeSelect:  $('#typeSelect'),

  startDate:   $('#startDate'),
  initialCounter: $('#initialCounter'),
};

// Tabla
const tbody = $('#machinesTbody');

/* ===== Estado ===== */
let fullList = [];
let viewList = [];

/* ===== Utils ===== */
function onlyDigits(s){ return String(s||'').replace(/\D/g,''); }
function fmtInt(n){ try{ return new Intl.NumberFormat('es-CL').format(Number(n||0)); } catch { return String(n||0); } }
function fmtDate(s){ if (!s) return '—'; const d = new Date(s); if (isNaN(d)) return '—'; return d.toLocaleDateString('es-CL'); }

/* ===== Form helpers ===== */
function clearSelection(){
  machineSelect.selectedIndex = 0;
  machineSearch.value = '';
}
function clearForm(){
  frm.reset(); editId.value='';
  $('#btnSave .btn-text').textContent = modeCreate.checked ? 'Registrar' : 'Guardar cambios';
  btnDelete.hidden = true;
  clearSelection();

  // desbloquear inputs empresa/prestador si estaban bloqueados por select
  toggleLinkedInput(f.companyExisting, f.company);
  toggleLinkedInput(f.providerExisting, f.provider);
  f.machineName.focus();
}
function fillForm(m){
  editId.value = m._id || '';
  f.machineName.value = m.machineName || '';

  // Empresa
  const comp = m.company || '';
  if (comp && hasOptionValue(f.companyExisting, comp)) {
    f.companyExisting.value = comp;
  } else {
    f.companyExisting.value = '';
  }
  f.company.value = comp || '';
  toggleLinkedInput(f.companyExisting, f.company);

  // Prestador
  const prov = m.provider || '';
  if (prov && hasOptionValue(f.providerExisting, prov)) {
    f.providerExisting.value = prov;
  } else {
    f.providerExisting.value = '';
  }
  f.provider.value = prov || '';
  toggleLinkedInput(f.providerExisting, f.provider);

  // Tipo
  f.typeSelect.value = TYPES.includes(m.type) ? m.type : '';

  f.startDate.value   = (m.startDate || '').slice(0,10);
  f.initialCounter.value = m.initialCounter ?? 0;

  $('#btnSave .btn-text').textContent = 'Guardar cambios';
  btnDelete.hidden = false;
}

/* ===== Modo ===== */
function updateModeUI(){
  if (modeCreate.checked){ searchPane.hidden = true; clearForm(); }
  else { searchPane.hidden = false; $('#btnSave .btn-text').textContent = 'Guardar cambios'; f.machineName.focus(); }
}
modeCreate.addEventListener('change', updateModeUI);
modeEdit.addEventListener('change', updateModeUI);

/* ===== Helpers selects ligados a inputs ===== */
function hasOptionValue(select, val){
  return Array.from(select.options).some(o => o.value === String(val));
}
function toggleLinkedInput(selectEl, inputEl){
  const v = selectEl.value.trim();
  const useSelect = v !== '';
  inputEl.disabled = useSelect;
  if (useSelect) inputEl.value = v;
}
f.companyExisting.addEventListener('change', () => toggleLinkedInput(f.companyExisting, f.company));
f.providerExisting.addEventListener('change', () => toggleLinkedInput(f.providerExisting, f.provider));

/* ===== Init / carga ===== */
async function ensureControlGate() {
  const r = await fetch('/api/control/status', { credentials: 'include' });
  const s = await r.json();
  if (!r.ok) throw new Error(s?.message || 'Error');
  if (!s.hasControlPass) {
    toast('No tienes acceso a esta función. Comunícate con el administrador.', 4200);
    setTimeout(() => location.href = '/dashboard', 1200);
    throw new Error('sin acceso');
  }
  if (!s.active) {
    location.href = '/dashboard';
    throw new Error('control inactivo');
  }
}
updateModeUI();
ensureLogged()
  .then(ensureControlGate)
  .then(loadMachines)
  .catch(() => {});

/* ===== Carga inicial + tabla ===== */
async function loadMachines(){
  try{
    const { list=[] } = await api(API);
    fullList = list.map(x => ({
      _id: x._id,
      machineName: x.machineName,
      initialCounter: Number(x.initialCounter ?? 0),
      company: x.company || '',
      provider: x.provider || '',
      type: x.type || '',
      startDate: x.startDate || ''
    })).sort((a,b)=> String(a.machineName||'').localeCompare(String(b.machineName||'')));

    // Poblar selects de empresa/prestador desde los ya registrados
    populateExistingSelects(fullList);

    filterAndRender(machineSearch.value.trim());
    renderTable(fullList);
  }catch(e){
    console.error(e); toast('Error cargando máquinas');
  }
}

function populateExistingSelects(arr){
  const companies = Array.from(new Set(arr.map(m => m.company).filter(Boolean))).sort((a,b)=>a.localeCompare(b));
  const providers = Array.from(new Set(arr.map(m => m.provider).filter(Boolean))).sort((a,b)=>a.localeCompare(b));

  f.companyExisting.innerHTML = `<option value="">— Seleccionar existente —</option>` +
    companies.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');

  f.providerExisting.innerHTML = `<option value="">— Seleccionar existente —</option>` +
    providers.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
}
function escapeHtml(s){ return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }

/* ===== Tabla ===== */
function renderTable(arr){
  if (!arr.length){
    tbody.innerHTML = `<tr><td colspan="6" style="padding:16px;color:#9aa3b2">Sin máquinas registradas</td></tr>`;
    return;
  }
  const rows = arr.map(m => `
    <tr data-id="${m._id}" class="row-click">
      <td>${m.machineName || '—'}</td>
      <td>${m.type || '—'}</td>
      <td>${m.company || '—'}</td>
      <td>${m.provider || '—'}</td>
      <td>${fmtDate(m.startDate)}</td>
      <td>${fmtInt(m.initialCounter)}</td>
    </tr>
  `);
  tbody.innerHTML = rows.join('');
}

/* Click en fila -> cargar en Modificar */
tbody.addEventListener('click', (e)=>{
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = tr.getAttribute('data-id');
  const m = fullList.find(x => String(x._id) === String(id));
  if (!m) return;

  if (modeCreate.checked){
    modeEdit.checked = true;
    modeCreate.checked = false;
    updateModeUI();
  }

  machineSearch.value = m.machineName || '';
  filterAndRender(machineSearch.value);
  machineSelect.value = m._id;
  fillForm(m);

  window.scrollTo({ top: 0, behavior: 'smooth' });
});

/* ===== Filtro para select ===== */
function filterAndRender(query){
  const q = query.trim().toLowerCase();
  const qDigits = onlyDigits(q);
  viewList = fullList.filter(m => {
    const name = String(m.machineName||'');
    const nameLC = name.toLowerCase();
    const digits = onlyDigits(name);
    const byText   = q ? nameLC.includes(q) : true;
    const byNumber = qDigits ? digits.includes(qDigits) : true;
    return byText || byNumber;
  });
  machineSelect.innerHTML = `<option value="">Selecciona una máquina…</option>` +
    viewList.map(m => `<option value="${m._id}">${escapeHtml(m.machineName)}</option>`).join('');
}
machineSearch.addEventListener('input', ()=> filterAndRender(machineSearch.value));

/* ===== Acciones ===== */
btnLoad.addEventListener('click', async ()=>{
  let m = null;
  const selId = machineSelect.value;
  if (selId){
    m = viewList.find(x => String(x._id) === String(selId)) ||
        fullList.find(x => String(x._id) === String(selId));
  } else {
    const typed = machineSearch.value.trim();
    if (!typed){ toast('Escribe o selecciona una máquina'); return; }
    try{
      m = await api(`${API}/by-name/${encodeURIComponent(typed)}`);
    }catch{}
    if (!m){
      const qDigits = onlyDigits(typed);
      m = fullList.find(x => onlyDigits(x.machineName).includes(qDigits));
    }
  }
  if (!m){ toast('No encontrada'); return; }

  if (modeCreate.checked){
    modeEdit.checked = true;
    modeCreate.checked = false;
    updateModeUI();
  }
  fillForm(m);
});

btnDelete.addEventListener('click', async ()=>{
  const id = editId.value;
  if (!id) return;
  if (!confirm('¿Eliminar esta máquina? Esta acción no se puede deshacer.')) return;
  try{
    await api(`${API}/${id}`, { method:'DELETE' });
    toast('Máquina eliminada');
    await loadMachines();
    clearForm();
  }catch(e){ console.error(e); toast(e.message || 'Error al eliminar'); }
});

btnClear.addEventListener('click', clearForm);

/* Guardar (crear/actualizar) */
frm.addEventListener('submit', async (e)=>{
  e.preventDefault();
  // Resolver valores efectivos según selección
  const companyVal  = f.companyExisting.value.trim()  || f.company.value.trim();
  const providerVal = f.providerExisting.value.trim() || f.provider.value.trim();
  const typeVal     = f.typeSelect.value.trim();

  const payload = {
    machineName: f.machineName.value.trim(),
    company:     companyVal,
    provider:    providerVal,
    type:        typeVal,
    startDate:   f.startDate.value.trim(),
    initialCounter: Number(f.initialCounter.value || 0)
  };

  try{
    if (modeCreate.checked || !editId.value){
      await api(API, { method:'POST', body: payload });
      toast('Máquina registrada');
      clearForm();
    } else {
      await api(`${API}/${editId.value}`, { method:'PUT', body: payload });
      toast('Cambios guardados');
    }
    await loadMachines();
  }catch(e2){ console.error(e2); toast(e2.message || 'Error al guardar'); }
});

/* Init */
updateModeUI();
ensureLogged().then(loadMachines);
