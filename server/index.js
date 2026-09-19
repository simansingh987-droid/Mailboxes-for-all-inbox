import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ROOT, settings, accounts, accountsInBatch, batches, getAccount, requireAccount, log } from './config.js';
import { mapLimit, closeAll } from './mail/pool.js';
import * as mail from './mail/service.js';
import * as store from './mail/store.js';
import { createMcpServer } from './mcp/tools.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Small in-memory limiter for password / token guesses (per IP, 10 failures per 15 minutes).
const failures = new Map();
function tooManyFailures(req) {
  const f = failures.get(req.ip);
  return f && f.count >= 10 && Date.now() - f.first < 15 * 60 * 1000;
}
function recordFailure(req) {
  const f = failures.get(req.ip);
  if (!f || Date.now() - f.first > 15 * 60 * 1000) failures.set(req.ip, { count: 1, first: Date.now() });
  else f.count++;
}
app.use(express.json({ limit: '35mb' }));

// ---------- auth ----------

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', settings.sessionSecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token) return false;
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return false;
  const expected = crypto.createHmac('sha256', settings.sessionSecret).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}

const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};

app.get('/api/session', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  res.json({ authRequired: !!settings.appPassword, authenticated: !settings.appPassword || verify(token) });
});

app.post('/api/login', (req, res) => {
  if (!settings.appPassword) return res.json({ token: 'open' });
  if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!safeEqual(req.body?.password || '', settings.appPassword)) {
    recordFailure(req);
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.json({ token: sign({ exp: Date.now() + 30 * 86400e3 }) });
});

app.use('/api', (req, res, next) => {
  if (!settings.appPassword) return next();
  const token = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
  if (verify(token)) return next();
  res.status(401).json({ error: 'Not signed in' });
});

const h = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (err) {
    log.warn(`${req.method} ${req.path}: ${err.message}`);
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message });
  }
};

function groupIds(ids) {
  const groups = new Map();
  for (const id of [].concat(ids || [])) {
    const p = mail.parseId(id);
    const k = `${p.slot}:${p.folderKey}`;
    if (!groups.has(k)) groups.set(k, { slot: p.slot, folderKey: p.folderKey, uids: [] });
    groups.get(k).uids.push(p.uid);
  }
  return [...groups.values()];
}

// ---------- accounts & overview ----------

app.get('/api/accounts', h(() => ({ accounts: store.accountOverview(), batches, sync: store.syncStatus() })));

app.get('/api/accounts/:slot/folders', h(async (req) => (await mail.getFolders(getAccount(req.params.slot))).list));

app.get('/api/resolve', h((req) => {
  const a = requireAccount(req.query.q);
  return { slot: a.slot, email: a.email, name: a.name };
}));

app.post('/api/sync', h(async (req) => {
  if (req.body?.slot) await store.syncAccount(getAccount(req.body.slot));
  else store.syncAll();
  return store.syncStatus();
}));

app.get('/api/stats', h((req) => store.stats(req.query.batch, req.query.slots ? String(req.query.slots).split(',').filter(Boolean) : undefined)));

app.get('/api/mcp-info', h(() => ({
  node: process.execPath,
  stdioPath: path.join(ROOT, 'server', 'mcp', 'stdio.js'),
  httpPath: '/mcp',
  connectorPath: settings.mcpToken ? `/mcp/${settings.mcpToken}` : null,
  publicUrl: process.env.PUBLIC_URL || null,
  token: settings.mcpToken || null,
})));

// ---------- messages ----------

app.get('/api/messages', h((req) => {
  const slots = req.query.slots ? String(req.query.slots).split(',').filter(Boolean) : undefined;
  return store.queryMessages({
    view: req.query.view || 'inbox',
    slots,
    batch: req.query.batch,
    q: req.query.q || '',
    offset: Number(req.query.offset) || 0,
    limit: Math.min(Number(req.query.limit) || 50, 200),
  });
}));

// Live folder listing (drafts, archive, junk, trash, custom folders)
app.get('/api/folders/:slot/:folder', h((req) =>
  mail.listMessages(getAccount(req.params.slot), req.params.folder, {
    limit: Math.min(Number(req.query.limit) || 50, 200),
    beforeUid: Number(req.query.beforeUid) || undefined,
  }),
));

// Deep server-side search across mailboxes
app.get('/api/search', h(async (req) => {
  const slots = req.query.slots ? String(req.query.slots).split(',') : accountsInBatch(req.query.batch).map((a) => a.slot);
  const targets = slots.map((s) => getAccount(s));
  const criteria = { text: req.query.q, from: req.query.from, subject: req.query.subject, since: req.query.since };
  const results = await mapLimit(targets, 16, (a) => mail.searchMessages(a, req.query.folder || 'inbox', criteria, 30));
  const messages = results.flatMap((r) => (r.ok ? r.value : [])).sort((a, b) => new Date(b.date) - new Date(a.date));
  return { total: messages.length, messages: messages.slice(0, 200) };
}));

app.get('/api/messages/:id', h(async (req) => {
  const { slot, folderKey, uid } = mail.parseId(req.params.id);
  const markSeen = req.query.markSeen !== '0';
  const m = await mail.getMessage(getAccount(slot), folderKey, uid, { markSeen });
  if (markSeen) store.patchCached(slot, folderKey, [uid], { seen: true });
  return m;
}));

app.get('/api/messages/:id/attachments/:index', h(async (req, res) => {
  const { slot, folderKey, uid } = mail.parseId(req.params.id);
  const a = await mail.getAttachment(getAccount(slot), folderKey, uid, Number(req.params.index));
  res.setHeader('Content-Type', a.contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${req.query.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(a.content);
}));

app.patch('/api/messages', h(async (req) => {
  const { ids, seen, flagged } = req.body || {};
  for (const g of groupIds(ids)) {
    await mail.setFlags(getAccount(g.slot), g.folderKey, g.uids, { seen, flagged });
    store.patchCached(g.slot, g.folderKey, g.uids, { ...(seen !== undefined && { seen }), ...(flagged !== undefined && { flagged }) });
  }
  return { ok: true };
}));

app.post('/api/messages/move', h(async (req) => {
  const { ids, to } = req.body || {};
  if (!['inbox', 'archive', 'junk', 'trash'].includes(to)) throw Object.assign(new Error('Invalid destination'), { status: 400 });
  for (const g of groupIds(ids)) {
    const account = getAccount(g.slot);
    if (to === 'trash') await mail.deleteMessages(account, g.folderKey, g.uids);
    else await mail.moveMessages(account, g.folderKey, g.uids, to);
    store.patchCached(g.slot, g.folderKey, g.uids, null);
    if (to === 'inbox') store.syncAccount(account);
  }
  return { ok: true };
}));

// ---------- sending ----------

app.post('/api/send', h(async (req) => {
  const b = req.body || {};
  const account = requireAccount(b.from);
  const r = await mail.sendMail(account, b);
  store.syncAccount(account);
  return r;
}));

app.post('/api/messages/:id/reply', h(async (req) => {
  const { slot, folderKey, uid } = mail.parseId(req.params.id);
  const account = getAccount(slot);
  const r = await mail.replyToMessage(account, folderKey, uid, req.body || {});
  store.patchCached(slot, folderKey, [uid], { answered: true });
  store.syncAccount(account);
  return r;
}));

app.post('/api/messages/:id/forward', h(async (req) => {
  const { slot, folderKey, uid } = mail.parseId(req.params.id);
  const account = getAccount(slot);
  const r = await mail.forwardMessage(account, folderKey, uid, req.body || {});
  store.syncAccount(account);
  return r;
}));

// ---------- live updates (SSE) ----------

app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('hello', store.syncStatus());
  const onNew = (d) => send('new-mail', { slot: d.slot, count: d.messages.length, messages: d.messages.slice(0, 5) });
  const onSync = (d) => send('sync', d);
  const onAccount = (d) => send('account-synced', d);
  store.events.on('new-mail', onNew);
  store.events.on('sync', onSync);
  store.events.on('account-synced', onAccount);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    store.events.off('new-mail', onNew);
    store.events.off('sync', onSync);
    store.events.off('account-synced', onAccount);
  });
});

// ---------- remote MCP over HTTP (for AI clients that connect by URL) ----------

// Two ways in: POST /mcp with "Authorization: Bearer <MCP_TOKEN>" (API clients), or
// POST /mcp/<MCP_TOKEN> — a secret URL for Claude's custom connectors, which cannot send headers.
app.all(['/mcp', '/mcp/:token'], async (req, res) => {
  if (!settings.mcpToken) return res.status(503).json({ error: 'Set MCP_TOKEN in .env to enable the HTTP MCP endpoint' });
  if (tooManyFailures(req)) return res.status(429).json({ error: 'Too many attempts' });
  const token = req.params.token || (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
  if (!token || !safeEqual(token, settings.mcpToken)) {
    recordFailure(req);
    return res.status(401).json({ error: 'Invalid MCP token' });
  }
  if (req.method !== 'POST') return res.status(405).set('Allow', 'POST').end();
  try {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log.error(`MCP request failed: ${err.message}`);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

// ---------- no OAuth ----------
// The MCP endpoint is authorised by the secret in its URL. Answer OAuth discovery with a clean 404 so
// MCP clients (e.g. Claude connectors) don't mistake the SPA's HTML for an OAuth server and try to
// register a client with it.
app.all([/^\/\.well-known\/.*/, '/register', '/authorize', '/token', '/oauth/*path'], (req, res) => {
  res.status(404).json({ error: 'not_found', message: 'This server does not use OAuth.' });
});

// ---------- static frontend (production build) ----------

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|mcp|\.well-known).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = app.listen(settings.port, settings.host, () => {
  log.info(`AskCruz Mailbox API on http://${settings.host}:${settings.port} — ${accounts.length} mailboxes`);
  if (!settings.appPassword) log.warn('APP_PASSWORD is not set — the dashboard is open to anyone who can reach it.');
  store.startBackgroundSync();
});

const shutdown = async () => {
  server.close();
  await closeAll();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
