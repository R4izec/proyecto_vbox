const jwt = require('jsonwebtoken');

/** Lee una cookie sin cookie-parser */
function readCookie(req, name) {
  const raw = req.headers?.cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Obtiene el token principal (header Bearer o cookie csf_token) */
function getAuthToken(req) {
  const h = req.headers['authorization'] || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const ck = readCookie(req, 'csf_token');
  return ck || null;
}

/** JWT de app */
function requireAuth(req, res, next) {
  const token = getAuthToken(req);
  if (!token) return res.status(401).json({ message: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // { id, username, comid, comkey, role? }
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Token inválido o expirado' });
  }
}

/** Control de acceso a Registrar/Modificar máquinas (cookie csf_ctrl firmada) */
function requireControl(req, res, next) {
  const token = readCookie(req, 'csf_ctrl');
  if (!token) return res.status(403).json({ message: 'Control no validado' });
  try {
    const dec = jwt.verify(token, process.env.JWT_SECRET);
    if (dec.typ !== 'ctrl') throw new Error('tipo inválido');
    next();
  } catch (e) {
    return res.status(403).json({ message: 'Control expirado o inválido' });
  }
}

/** === NUEVO: guard por rol */
function requireRole(roleExpected) {
  return (req, res, next) => {
    const role = (req?.user?.role || '').toString().trim().toLowerCase();
    if (role !== roleExpected) {
      return res.status(403).json({ message: 'No autorizado (rol)' });
    }
    next();
  };
}

module.exports = { requireAuth, requireControl, requireRole, readCookie };
