require('dotenv').config();
const path = require('path');
const express = require('express');
const { connect } = require('./services/db');
const { requireAuth, requireRole } = require('./middleware/requireAuth'); // <-- IMPORTA requireRole

const app = express();

process.env.TZ = process.env.APP_TZ || 'America/Santiago';

// Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// estáticos
app.use(express.static(path.join(__dirname, 'public')));

// DB
connect().catch(err => {
  console.error('Error conectando a Mongo:', err);
  process.exit(1);
});

// Routers API
app.use('/api', require('./routes/authRoutes'));
app.use('/api/monitor', require('./routes/monitorRoutes'));
app.use('/api/history', require('./routes/historyRoutes'));
app.use('/api/maquinas', require('./routes/maquinasRoutes'));
app.use('/api/exports', require('./routes/exports'));
app.use('/api/changes',  require('./routes/changesRoutes'));

// Páginas
app.get('/', (_req, res) => res.redirect('/login'));

app.get('/login', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'login', 'login.html'))
);

app.get('/dashboard', requireAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'dashboard', 'dashboard.html'))
);

// === NUEVO: dashboard de empresa (requiere rol empresa)
app.get('/dashboarde', requireAuth, requireRole('empresa'), (_req, res) => {
  // Ajusta la ruta del archivo según tu estructura:
  // Opción A: /public/dashboarde/dashboarde.html
  const candidateA = path.join(__dirname, 'public', 'dashboarde', 'dashboarde.html');
  // Opción B (si lo tienes directo en /public): /public/dashboarde.html
  const candidateB = path.join(__dirname, 'public', 'dashboarde.html');

  res.sendFile(candidateA, (err) => {
    if (err) {
      // fallback a la opción B por si tu estructura es diferente
      res.sendFile(candidateB, (err2) => {
        if (err2) {
          res.status(404).send('dashboarde.html no encontrado. Verifica la ruta en /public.');
        }
      });
    }
  });
});

app.get('/informes', requireAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'informes', 'informes.html'))
);

app.get('/historicos', requireAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'historicos', 'historicos.html'))
);

app.get('/emaildata', requireAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'emaildata', 'emaildata.html'))
);

app.get('/maquinas', requireAuth, (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'maquinas', 'maquinas.html'))
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
