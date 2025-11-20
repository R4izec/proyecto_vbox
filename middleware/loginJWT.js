const jwt = require('jsonwebtoken');

const secretKey = process.env.JWT_SECRET || 'fb381f5c8e4146a2b5ff9a3cd57ac9f2cfe2a22d42a44a1e9d6e8bc49a777c18';

function generateToken(payload, expiresIn = '1h') {
  return jwt.sign(payload, secretKey, { expiresIn });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, secretKey);
  } catch (err) {
    return null;
  }
}

function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
  }
  res.status(401).json({ message: 'Unauthorized' });
}

module.exports = {
  generateToken,
  verifyToken,
  authenticateJWT
};
