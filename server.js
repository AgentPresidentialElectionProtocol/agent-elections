const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3100;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static assets
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Serve skill files at root level (the Moltbook pattern)
app.get('/skill.md', (req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'skill.md'));
});

app.get('/heartbeat.md', (req, res) => {
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'heartbeat.md'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'APEP Election API', version: '1.0.0' });
});

// API Routes (order matters! election.js has catch-all /:id so must be last)
app.use('/api/election', require('./routes/registration'));
app.use('/api/election', require('./routes/candidates'));
app.use('/api/election', require('./routes/voting'));
app.use('/api/election', require('./routes/results'));
app.use('/api/election', require('./routes/presidential'));
app.use('/api/election', require('./routes/admin'));
app.use('/api/election', require('./routes/election')); // Last: has /:id catch-all

// Frontend Routes (after API routes so /api/ paths take priority)
app.use('/', require('./routes/frontend'));

// Start cron jobs
require('./cron/phase-advance');

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`APEP Election API running on http://${HOST}:${PORT}`);
  console.log(`Skill file: http://${HOST}:${PORT}/skill.md`);
  console.log(`Heartbeat: http://${HOST}:${PORT}/heartbeat.md`);
  console.log(`Dashboard: http://${HOST}:${PORT}/`);
});
