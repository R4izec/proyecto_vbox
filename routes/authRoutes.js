const express = require('express');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const router = express.Router();
const { getCollection } = require('../services/db');
const { VBoxClient } = require('../services/vboxClient');
const { requireAuth } = require('../middleware/requireAuth');

// ==== helpers
function setAuthCookie(res, token) {
  res.cookie('csf_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000, // 1h
    path: '/',
    // secure: true, // <-- habilitar en producción con HTTPS
  });
}

// ---- LISTAR USUARIOS
router.get('/users', async (_req, res) => {
  try {
    const users = await getCollection('users')
      .find({}, { projection: { password: 0 } })
      .toArray();
    res.json(users);
  } catch (e) {
    console.error('[users] ', e);
    res.status(500).json({ message: 'Error listando usuarios' });
  }
});

// ---- LOGIN: crea cookie httpOnly + devuelve datos para el front
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ message: 'Falta usuario o contraseña' });
    }

    const user = await getCollection('users').findOne({ username });
    if (!user) return res.status(401).json({ message: 'Credenciales inválidas' });

    const passOk = String(user.password || '').trim() === String(password || '').trim();
    if (!passOk) return res.status(401).json({ message: 'Credenciales inválidas' });

    // Login contra V-BOX
    const client = new VBoxClient({
      comid: user.comid,
      comkey: (user.comkey || '').trim(),
      region: 'eu'
    });
    const { sid, utype, ztRole } = await client.login({
      alias: (user.vbox_alias || user.username || '').trim(),
      password
    });

    // === NUEVO: incluir role en el JWT y responderlo al front
    const userRole = (user.role || '').toString().trim(); // ej: "empresa" o ""
    const token = jwt.sign(
      { id: String(user._id), username: user.username, comid: user.comid, comkey: user.comkey, role: userRole },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Cookie httpOnly para proteger las páginas
    setAuthCookie(res, token);

    // Opcionalmente devolvemos el jwt para que el front lo use en Authorization
    return res.json({
      message: 'Login OK',
      sid,
      utype,
      ztRole,
      jwt: token,
      user: { id: user._id, username: user.username, role: userRole }
    });
  } catch (e) {
    console.error('[login] ', e);
    return res.status(502).json({ message: e.message || 'Fallo login V-BOX' });
  }
});

// ---- ME (protegido)
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user }); // req.user incluye role desde el JWT
});

// ---- LOGOUT: limpia cookies de sesión y control
router.post('/logout', (_req, res) => {
  try {
    res.clearCookie('csf_token', { path: '/' });
    res.clearCookie('csf_ctrl', { path: '/' });
  } catch {}
  res.json({ ok: true });
});

// ================= CONTROL PASS =================

// ¿tiene controlPass y está activo en esta sesión?
router.get('/control/status', requireAuth, async (req, res) => {
  try {
    const user = await getCollection('users').findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { controlPass: 1 } }
    );
    const hasControlPass = !!(user && String(user.controlPass || '').trim());
    let active = false;

    const raw = req.headers?.cookie || '';
    const m = raw.match(/(?:^|;\s*)csf_ctrl=([^;]*)/);
    if (m) {
      try {
        const tok = decodeURIComponent(m[1]);
        const dec = jwt.verify(tok, process.env.JWT_SECRET);
        active = dec?.typ === 'ctrl';
      } catch {
        active = false;
      }
    }

    res.json({ ok: true, hasControlPass, active });
  } catch (e) {
    console.error('[control/status]', e);
    res.status(500).json({ message: 'Error verificando acceso' });
  }
});

// valida la contraseña de control y setea cookie httpOnly 'csf_ctrl'
router.post('/control/validate', requireAuth, async (req, res) => {
  try {
    const { pass } = req.body || {};
    if (!pass) return res.status(400).json({ message: 'Contraseña requerida' });

    const user = await getCollection('users').findOne({ _id: new ObjectId(req.user.id) });
    if (!user) return res.status(401).json({ message: 'Usuario no encontrado' });

    const stored = String(user.controlPass || '').trim();
    if (!stored) return res.status(403).json({ message: 'No tienes acceso a esta función' });

    const ok = stored === String(pass).trim(); // (puedes reemplazar por bcrypt.compare)
    if (!ok) return res.status(401).json({ message: 'Contraseña inválida' });

    const ctrlToken = jwt.sign(
      { sub: String(user._id), typ: 'ctrl' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    res.cookie('csf_ctrl', ctrlToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 60 * 60 * 1000,
      path: '/',
      // secure: true, // en producción con HTTPS
    });

    res.json({ ok: true, active: true });
  } catch (e) {
    console.error('[control/validate]', e);
    res.status(500).json({ message: 'Error validando contraseña' });
  }
});

module.exports = router;
