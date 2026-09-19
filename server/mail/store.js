import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { accounts, accountsInBatch, settings, DATA_DIR, log, publicAccount } from '../config.js';
import { withImap, mapLimit, getHealth } from './pool.js';
import { getFolders, toSummary, fetchSnippets } from './service.js';

/**
 * In-memory cache of the newest INBOX and Sent messages of every mailbox, refreshed in the
 * background and persisted to data/cache.json so the unified inbox renders instantly.
 */
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const SYNC_FOLDERS = [
  ['inbox', () => settings.inboxDepth],
  ['sent', () => settings.sentDepth],
];

export const events = new EventEmitter();
events.setMaxListeners(100);

function readCacheFile() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {}
  return null;
}

let state = readCacheFile() || { accounts: {} };

const syncing = new Map(); // slot -> promise
let lastFullSync = state.lastFullSync || null;
let fullSyncRunning = null;

function acc(slot) {
  if (!state.accounts[slot]) state.accounts[slot] = { folders: {}, unread: 0, lastSync: null, error: null };
  return state.accounts[slot];
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ ...state, lastFullSync }));
      fs.renameSync(tmp, CACHE_FILE);
    } catch (err) {
      log.warn(`Cache save failed: ${err.message}`);
    }
  }, 1000);
}

async function syncFolder(account, key, depth) {
  const { map } = await getFolders(account);
  const folderPath = map[key];
  if (!folderPath) return { added: [] };
  const entry = acc(account.slot);
  const prev = entry.folders[key] || { uidValidity: null, messages: [] };

  return withImap(account, folderPath, async (client) => {
    const mb = client.mailbox;
    const uidValidity = String(mb.uidValidity);
    const known = prev.uidValidity === uidValidity ? new Map(prev.messages.map((m) => [m.uid, m])) : new Map();
    let unread = null;
    if (key === 'inbox') unread = ((await client.search({ seen: false }, { uid: true })) || []).length;

    const messages = [];
    if (mb.exists) {
      const range = `${Math.max(1, mb.exists - depth + 1)}:*`;
      for await (const m of client.fetch(range, { uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true, size: true })) {
        const s = toSummary(m, account, key);
        const old = known.get(m.uid);
        if (old) s.snippet = old.snippet;
        messages.push(s);
      }
      const fresh = messages.filter((m) => !known.has(m.uid)).map((m) => m.uid);
      if (fresh.length) {
        const snippets = await fetchSnippets(client, fresh);
        messages.forEach((m) => { if (snippets.has(m.uid)) m.snippet = snippets.get(m.uid); });
      }
    }
    messages.sort((a, b) => new Date(b.date) - new Date(a.date));
    const added = prev.uidValidity === uidValidity ? messages.filter((m) => !known.has(m.uid)) : [];
    entry.folders[key] = { uidValidity, messages, total: mb.exists };
    if (unread !== null) entry.unread = unread;
    return { added };
  });
}

export function syncAccount(account) {
  if (syncing.has(account.slot)) return syncing.get(account.slot);
  const p = (async () => {
    const entry = acc(account.slot);
    const firstSync = !entry.lastSync;
    try {
      const newMail = [];
      for (const [key, depth] of SYNC_FOLDERS) {
        const { added } = await syncFolder(account, key, depth());
        if (key === 'inbox' && !firstSync) newMail.push(...added.filter((m) => !m.seen));
      }
      entry.lastSync = Date.now();
      entry.error = null;
      if (newMail.length) events.emit('new-mail', { slot: account.slot, messages: newMail });
    } catch (err) {
      entry.error = err.message;
      log.warn(`Sync ${account.slot} failed: ${err.message}`);
    } finally {
      syncing.delete(account.slot);
      persist();
      events.emit('account-synced', { slot: account.slot });
    }
  })();
  syncing.set(account.slot, p);
  return p;
}

export function syncAll() {
  if (fullSyncRunning) return fullSyncRunning;
  const started = Date.now();
  fullSyncRunning = mapLimit(accounts, settings.syncConcurrency, syncAccount).then(() => {
    lastFullSync = Date.now();
    fullSyncRunning = null;
    persist();
    log.info(`Synced ${accounts.length} mailboxes in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    events.emit('sync', syncStatus());
  });
  return fullSyncRunning;
}

/**
 * Make sure the cache is reasonably fresh without making callers wait for a full sync:
 * pick up a newer cache written by another process (the web server), otherwise refresh in
 * the background and wait at most maxWaitSec (the full wait only when nothing is cached yet).
 */
export async function ensureFresh(maxAgeSec = 120, maxWaitSec = 25) {
  const stale = () => !lastFullSync || Date.now() - lastFullSync > maxAgeSec * 1000;
  if (!stale()) return;
  const disk = readCacheFile();
  if (disk?.lastFullSync && disk.lastFullSync > (lastFullSync || 0) && !fullSyncRunning) {
    state = disk;
    lastFullSync = disk.lastFullSync;
    if (!stale()) return;
  }
  const hasData = Object.keys(state.accounts || {}).length > 0;
  const run = syncAll();
  await Promise.race([run, new Promise((r) => setTimeout(r, (hasData ? maxWaitSec : 50) * 1000))]);
}

export function startBackgroundSync() {
  syncAll();
  setInterval(syncAll, settings.syncIntervalSec * 1000).unref();
}

export function syncStatus() {
  return { running: !!fullSyncRunning, lastFullSync, accounts: accounts.length };
}

// ---------- queries over the cache ----------

export function accountOverview(batch) {
  return accountsInBatch(batch).map((a) => {
    const e = state.accounts[a.slot] || {};
    const inbox = e.folders?.inbox;
    const h = getHealth(a.slot);
    return {
      ...publicAccount(a),
      unread: e.unread || 0,
      total: inbox?.total || 0,
      lastSync: e.lastSync || null,
      status: e.error ? 'error' : e.lastSync ? 'ok' : 'pending',
      error: e.error || (h && !h.ok ? h.error : null),
      latest: inbox?.messages?.[0]?.date || null,
    };
  });
}

function allCached(folder, batch) {
  const keys = folder === 'sent' ? ['sent'] : folder === 'all' ? ['inbox', 'sent'] : ['inbox'];
  const allowed = new Set(accountsInBatch(batch).map((a) => a.slot));
  const out = [];
  for (const [slot, e] of Object.entries(state.accounts)) {
    if (!allowed.has(slot)) continue;
    for (const k of keys) for (const m of e.folders?.[k]?.messages || []) out.push({ ...m, slot });
  }
  return out;
}

const matches = (m, q) => {
  const hay = `${m.subject} ${m.from.name} ${m.from.address} ${m.to.map((t) => `${t.name} ${t.address}`).join(' ')} ${m.snippet} ${m.slot} ${m.account}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

/**
 * Unified list. view: inbox | unread | starred | sent | all | attachments
 */
export function queryMessages({ view = 'inbox', slots, batch, q, offset = 0, limit = 50 } = {}) {
  const folder = view === 'sent' ? 'sent' : view === 'all' ? 'all' : 'inbox';
  let list = allCached(folder, batch);
  if (slots?.length) {
    const set = new Set(slots.map((s) => s.toUpperCase()));
    list = list.filter((m) => set.has(m.slot));
  }
  if (view === 'unread') list = list.filter((m) => !m.seen);
  if (view === 'starred') list = allCached('all', batch).filter((m) => m.flagged && (!slots?.length || slots.includes(m.slot)));
  if (view === 'attachments') list = list.filter((m) => m.attachments > 0);
  if (q) list = list.filter((m) => matches(m, q));
  list.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { total: list.length, messages: list.slice(offset, offset + limit) };
}

export function stats(batch, slots) {
  const only = slots?.length ? new Set(slots.map((s) => s.toUpperCase())) : null;
  const pick = (list) => (only ? list.filter((m) => only.has(m.slot)) : list);
  const inbox = pick(allCached('inbox', batch));
  const sent = pick(allCached('sent', batch));
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ date: d.toISOString().slice(0, 10), received: 0, sent: 0 });
  }
  const byDay = new Map(days.map((d) => [d.date, d]));
  const dayKey = (iso) => {
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  };
  inbox.forEach((m) => { const d = byDay.get(dayKey(m.date)); if (d) d.received++; });
  sent.forEach((m) => { const d = byDay.get(dayKey(m.date)); if (d) d.sent++; });

  const senders = new Map();
  inbox.forEach((m) => {
    if (!m.from.address || accounts.some((a) => a.email === m.from.address)) return;
    const s = senders.get(m.from.address) || { address: m.from.address, name: m.from.name, count: 0, latest: m.date, slots: new Set() };
    s.count++;
    s.slots.add(m.slot);
    if (m.date > s.latest) s.latest = m.date;
    senders.set(m.from.address, s);
  });
  const topSenders = [...senders.values()]
    .sort((a, b) => b.count - a.count || (b.latest > a.latest ? 1 : -1))
    .slice(0, 8)
    .map((s) => ({ ...s, slots: [...s.slots] }));

  const overview = accountOverview(batch).filter((a) => !only || only.has(a.slot));
  const replies = inbox.filter((m) => /^re:/i.test(m.subject) && !accounts.some((a) => a.email === m.from.address));
  return {
    mailboxes: overview.length,
    healthy: overview.filter((a) => a.status === 'ok').length,
    failing: overview.filter((a) => a.status === 'error').map((a) => ({ slot: a.slot, email: a.email, error: a.error })),
    unread: overview.reduce((n, a) => n + a.unread, 0),
    received: inbox.length,
    sent: sent.length,
    replies: replies.length,
    days,
    topSenders,
    lastFullSync,
  };
}

/** Update a cached summary after a flag change / move so the UI stays consistent. */
export function patchCached(slot, folderKey, uids, patch) {
  const f = state.accounts[slot]?.folders?.[folderKey];
  if (!f) return;
  const set = new Set(uids.map(Number));
  const e = state.accounts[slot];
  let unreadDelta = 0;
  if (patch === null) {
    f.messages = f.messages.filter((m) => {
      if (!set.has(m.uid)) return true;
      if (!m.seen) unreadDelta--;
      return false;
    });
  } else {
    f.messages.forEach((m) => {
      if (!set.has(m.uid)) return;
      if ('seen' in patch && patch.seen !== m.seen) unreadDelta += patch.seen ? -1 : 1;
      Object.assign(m, patch);
    });
  }
  if (folderKey === 'inbox') e.unread = Math.max(0, (e.unread || 0) + unreadDelta);
  persist();
}
