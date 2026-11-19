'use strict';

const path = require('node:path');
const express = require('express');
const config = require('./config');
const auth = require('./auth');
const api = require('./api');
const scheduler = require('./scheduler');

auth.ensureAdmin();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  });
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.use('/api', express.json({ limit: '50kb' }), auth.csrfGuard, auth.sessionMiddleware, api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, index: 'index.html' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(config.port, () => {
  console.log(`[server] on-call scheduler listening on :${config.port}`);
  if (config.yeastar.dryRun) console.log('[server] YEASTAR_DRY_RUN is on – no changes will be sent to the PBX');
  scheduler.start();
  setInterval(auth.cleanupSessions, 3600 * 1000);
});
