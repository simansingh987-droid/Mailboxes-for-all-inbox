import { ImapFlow } from 'imapflow';
import { settings, log } from '../config.js';

/**
 * Keeps one IMAP connection per mailbox, capped at settings.maxConnections.
 * Least-recently-used idle connections are closed when the cap is reached.
 */
const pool = new Map(); // slot -> { client, connecting, lastUsed, busy }
const health = new Map(); // slot -> { ok, error, checkedAt }

export function getHealth(slot) {
  return health.get(slot) || null;
}

function setHealth(slot, ok, error) {
  health.set(slot, { ok, error: error ? String(error.message || error) : null, checkedAt: Date.now() });
}

async function evictIfNeeded() {
  if (pool.size < settings.maxConnections) return;
  const idle = [...pool.entries()]
    .filter(([, e]) => !e.busy && e.client)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  const [slot, entry] = idle[0] || [];
  if (!slot) return;
  pool.delete(slot);
  entry.client.logout().catch(() => entry.client.close());
}

async function connect(account) {
  await evictIfNeeded();
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure !== false,
    auth: { user: account.email, pass: account.password },
    logger: false,
    emitLogs: false,
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 5 * 60 * 1000,
  });
  client.on('error', (err) => {
    log.warn(`IMAP ${account.slot} error: ${err.message}`);
  });
  client.on('close', () => {
    const e = pool.get(account.slot);
    if (e && e.client === client) pool.delete(account.slot);
  });
  try {
    await client.connect();
    setHealth(account.slot, true);
    return client;
  } catch (err) {
    const reason = err.authenticationFailed ? 'Authentication failed' : err.responseText || err.message;
    setHealth(account.slot, false, reason);
    throw Object.assign(new Error(`${account.slot} (${account.email}): ${reason}`), { status: 502 });
  }
}

async function getClient(account) {
  let entry = pool.get(account.slot);
  if (entry?.client?.usable) return entry;
  if (entry?.connecting) {
    await entry.connecting;
    return pool.get(account.slot) || getClient(account);
  }
  entry = { client: null, busy: 0, lastUsed: Date.now() };
  entry.connecting = connect(account)
    .then((c) => { entry.client = c; })
    .finally(() => { entry.connecting = null; });
  pool.set(account.slot, entry);
  try {
    await entry.connecting;
  } catch (err) {
    pool.delete(account.slot);
    throw err;
  }
  return entry;
}

/**
 * Run fn(client) against the account's IMAP connection. When `path` is given, the
 * mailbox is selected and locked for the duration of fn.
 */
export async function withImap(account, path, fn) {
  let attempt = 0;
  while (true) {
    const entry = await getClient(account);
    entry.busy++;
    entry.lastUsed = Date.now();
    let lock;
    try {
      if (path) lock = await entry.client.getMailboxLock(path);
      return await fn(entry.client);
    } catch (err) {
      const connectionLost = !entry.client.usable || /connection|socket|ECONN|closed/i.test(err.message || '');
      if (connectionLost && attempt === 0) {
        attempt++;
        pool.delete(account.slot);
        continue;
      }
      throw err;
    } finally {
      lock?.release();
      entry.busy--;
      entry.lastUsed = Date.now();
    }
  }
}

export async function closeAll() {
  await Promise.all([...pool.values()].map((e) => e.client?.logout().catch(() => {})));
  pool.clear();
}

/** Run async tasks over items with bounded concurrency; never rejects. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
