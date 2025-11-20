// ===== Menú / Logout =====
const menuBtn = document.getElementById('menuBtn');
const menu = document.getElementById('userMenu');
const logoutBtn = document.getElementById('logoutBtn');

function toggleMenu(open) {
  const isOpen = typeof open === 'boolean' ? open : !menu.classList.contains('open');
  menu.classList.toggle('open', isOpen);
  menuBtn?.setAttribute('aria-expanded', String(isOpen));
}
menuBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
document.addEventListener('click', (e) => {
  if (!menu || !menuBtn) return;
  if (menu.contains(e.target) || menuBtn.contains(e.target)) return;
  toggleMenu(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleMenu(false); });

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

// ===== Toast =====
const toast = document.getElementById('toast');
toast?.querySelector('.close')?.addEventListener('click', () => toast.classList.remove('show'));
function showToast(message, ms = 2200) {
  if (!toast) return;
  toast.querySelector('.msg').textContent = message;
  toast.hidden = false;
  toast.classList.add('show');
  if (ms > 0) setTimeout(() => toast.classList.remove('show'), ms);
}

// ===== Sesión =====
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

// ===== API Exports =====
const sid = localStorage.getItem('vbox_sid');

async function apiListExports(query={}) {
  // Soporta ?type=
  const url = new URL('/api/exports/list', location.origin);
  if (query.type) url.searchParams.set('type', query.type);
  const resp = await fetch(url.pathname + url.search, {
    credentials: 'include',
    headers: { 'x-vbox-sid': sid || '' }
  });
  const json = await resp.json().catch(()=> ({}));
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) location.href = '/login';
    throw new Error(json?.message || 'No se pudo listar informes');
  }
  return json;
}

// ===== Utilidades de tiempo =====
const TZ = 'America/Santiago';
function toLocalDate(d) { return new Date(d).toLocaleDateString('es-CL', { timeZone: TZ }); }
function toLocalTime(d) { return new Date(d).toLocaleTimeString('es-CL', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function parseDateFromFilename(name) {
  const m = name.match(/(\d{4})[-_](\d{2})[-_](\d{2})[-_](\d{2})[-_](\d{2})[-_](\d{2})/);
  if (!m) return null;
  const [, Y, M, D, h, mnt, s] = m;
  const iso = `${Y}-${M}-${D}T${h}:${mnt}:${s}`;
  return new Date(iso);
}
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function isSameDay(a, b) {
  const A = new Date(a), B = new Date(b);
  return A.getFullYear() === B.getFullYear() && A.getMonth() === B.getMonth() && A.getDate() === B.getDate();
}

// ===== DOM =====
const tbody     = document.getElementById('reportsTbody');
const emptyState= document.getElementById('emptyState');
const mTotal    = document.getElementById('mTotal');
const mToday    = document.getElementById('mToday');

const quickDay  = document.getElementById('quickDay');
const dateExact = document.getElementById('dateExact');

const typeFilter= document.getElementById('typeFilter'); // NUEVO
const qMachine  = document.getElementById('qMachine');   // NUEVO

const btnClear  = document.getElementById('btnClear');

let allItems = [];

// === SOLO 3 COLUMNAS: Nombre | Fecha | Acción (se mantiene)
function renderTable(items) {
  if (!tbody) return;
  if (!items.length) {
    tbody.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  const rows = items.map(it => {
    const d = it.date;
    const fecha = d ? `${toLocalDate(d)} ${toLocalTime(d)}` : '—';
    const url = it.url || `/api/exports/file/${encodeURIComponent(it.filename)}`;
    const nameCell = it.machineName ? `${it.filename} <span style="color:#9aa3b2;display:block;font-size:.85rem;">${it.machineName}</span>` : it.filename;
    return `
      <tr>
        <td class="t-name">${nameCell}</td>
        <td>${fecha}</td>
        <td><a class="btn-download" href="${url}" download>Descargar</a></td>
      </tr>
    `;
  }).join('');
  tbody.innerHTML = rows;
}

function updateMetrics() {
  const total = allItems.length;
  const today = allItems.filter(it => isSameDay(it.date, new Date())).length;
  mTotal.textContent = String(total);
  mToday.textContent = String(today);
}

// Normaliza servidor -> UI
function normalizeItems(raw) {
  const items = (raw?.items || raw || []).map(x => {
    const filename = x.filename || x.name || '';
    const t = x.createdAt || x.mtime || x.ctime || null;
    const d = t ? new Date(t) : parseDateFromFilename(filename);
    return {
      filename,
      url: x.url || '',
      date: d || new Date(0),
      // NUEVO: usamos type y machineName si viniera en meta
      type: x.type || '',               // 'general' | 'weekly' | 'individual' | 'other'
      machineName: x.machineName || '', // si está en meta
      boxId: x.boxId || ''
    };
  });
  items.sort((a, b) => b.date - a.date);
  return items;
}

// Aplica TODOS los filtros (fecha + tipo + búsqueda)
function applyFilters() {
  let filtered = allItems.slice();

  // Filtro por fecha exacta (prioritario)
  const exact = dateExact?.value;
  if (exact) {
    const target = new Date(exact + 'T00:00:00');
    filtered = filtered.filter(it => isSameDay(it.date, target));
    // Aún así aplicamos texto/tipo encima:
  } else {
    // Rango rápido
    const mode = quickDay?.value || 'all';
    if (mode === 'today') {
      const s = startOfDay(new Date()); const e = endOfDay(new Date());
      filtered = filtered.filter(it => it.date >= s && it.date <= e);
    } else if (mode === 'yesterday') {
      const t = new Date(); t.setDate(t.getDate() - 1);
      const s = startOfDay(t); const e = endOfDay(t);
      filtered = filtered.filter(it => it.date >= s && it.date <= e);
    } else if (mode === '7') {
      const e = new Date();
      const s = new Date(); s.setDate(s.getDate() - 7);
      filtered = filtered.filter(it => it.date >= s && it.date <= e);
    } else if (mode === '30') {
      const e = new Date();
      const s = new Date(); s.setDate(s.getDate() - 30);
      filtered = filtered.filter(it => it.date >= s && it.date <= e);
    }
  }

  // NUEVO: filtro por tipo
  const ttype = (typeFilter?.value || '').trim();
  if (ttype) {
    filtered = filtered.filter(it => (it.type || '') === ttype);
  }

  // NUEVO: búsqueda por máquina o texto (en filename + machineName)
  const q = (qMachine?.value || '').trim().toLowerCase();
  if (q) {
    const norm = (s) => String(s||'').toLowerCase();
    filtered = filtered.filter(it => {
      return norm(it.filename).includes(q) || norm(it.machineName).includes(q);
    });
  }

  renderTable(filtered);
}

async function loadReports() {
  try {
    // Permitimos que el backend filtre por tipo si se elige desde el inicio,
    // pero igual normalizamos y volvemos a aplicar filtros en el cliente.
    const typeParam = (typeFilter?.value || '').trim();
    const res = await apiListExports({ type: typeParam || undefined });

    allItems = normalizeItems(res);
    updateMetrics();
    applyFilters();

    if (!allItems.length) {
      emptyState.classList.remove('hidden');
      tbody.innerHTML = '';
    }
  } catch (e) {
    console.error(e);
    tbody.innerHTML = `<tr><td colspan="3">No se pudieron cargar los informes.</td></tr>`;
    showToast('Error cargando informes', 2500);
  }
}

// Listeners existentes
quickDay?.addEventListener('change', () => {
  if (dateExact.value) return;
  applyFilters();
});
dateExact?.addEventListener('change', applyFilters);
btnClear?.addEventListener('click', () => {
  quickDay.value = 'all';
  dateExact.value = '';
  typeFilter.value = ''; // NUEVO
  qMachine.value = '';   // NUEVO
  applyFilters();
});

// NUEVO: listeners para filtros añadidos
typeFilter?.addEventListener('change', () => {
  // Al cambiar tipo, recargamos del servidor con ?type= para reducir payload,
  // y luego volvemos a aplicar todos los filtros en el cliente (incluida búsqueda).
  loadReports();
});
qMachine?.addEventListener('input', applyFilters);

// ====== CONTROL PASS (gating hacia /maquinas) ======
function machinesLinkEl() {
  return document.getElementById('linkMachines') || document.querySelector('a[href="/maquinas"]');
}

let ctrlModal;
function ensureControlModal() {
  if (ctrlModal) return ctrlModal;
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.dataset.kind = 'control-pass';
  overlay.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="ctrlTitle">
      <h3 id="ctrlTitle">Acceso restringido</h3>
      <p>Ingresa tu contraseña de control para continuar.</p>
      <div style="margin:12px 0;">
        <input id="ctrlInput" type="password" placeholder="Contraseña de control" autocomplete="off" style="width:100%;padding:10px;border-radius:10px;border:1px solid #2b2f3a;background:#1b1f2a;color:#e8eef9;">
      </div>
      <div class="modal-buttons">
        <button type="button" class="cancel">Cancelar</button>
        <button type="button" class="primary confirm">Validar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#ctrlInput');
  const open  = () => { overlay.classList.add('open'); document.body.style.overflow='hidden'; setTimeout(()=>input?.focus(), 50); };
  const close = () => { overlay.classList.remove('open'); document.body.style.overflow=''; input.value=''; };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (overlay.classList.contains('open') && e.key === 'Escape') close(); });
  overlay.querySelector('.cancel').addEventListener('click', close);

  async function submit() {
    const pass = (input.value || '').trim();
    if (!pass) { input.focus(); return; }
    const btn = overlay.querySelector('.confirm');
    btn.disabled = true;
    try {
      const r = await fetch('/api/control/validate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pass })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        (typeof showToast === 'function') ? showToast(j.message || 'Contraseña inválida', 3000) : alert(j.message || 'Contraseña inválida');
        return;
      }
      close();
      location.href = '/maquinas';
    } catch {
      (typeof showToast === 'function') ? showToast('Error de red', 2500) : alert('Error de red');
    } finally {
      btn.disabled = false;
    }
  }
  overlay.querySelector('.confirm').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  ctrlModal = { open, close, el: overlay };
  return ctrlModal;
}

async function handleGoMachines(e) {
  e?.preventDefault?.();
  try {
    const r = await fetch('/api/control/status', { credentials: 'include' });
    const s = await r.json();
    if (!r.ok) throw new Error(s?.message || 'Error consultando acceso');

    if (!s.hasControlPass) {
      (typeof showToast === 'function')
        ? showToast('No tienes acceso a esta función. Comunícate con el administrador.', 4200)
        : alert('No tienes acceso a esta función. Comunícate con el administrador.');
      return;
    }
    if (s.active) {
      location.href = '/maquinas';
      return;
    }
    ensureControlModal().open();
  } catch (err) {
    (typeof showToast === 'function') ? showToast('Error verificando permisos', 2600) : alert('Error verificando permisos');
  } finally {
    typeof toggleMenu === 'function' && toggleMenu(false);
  }
}

const lk = machinesLinkEl();
lk && lk.addEventListener('click', handleGoMachines);

// Boot
ensureLogged().then(loadReports);
