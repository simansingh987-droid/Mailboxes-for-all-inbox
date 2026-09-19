import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { parseSlotSelection } from '../shared/slots.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

export const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// All logging goes to stderr so the stdio MCP server keeps stdout clean for JSON-RPC.
export const log = {
  info: (...a) => console.error('[askcruz]', ...a),
  warn: (...a) => console.error('[askcruz:warn]', ...a),
  error: (...a) => console.error('[askcruz:error]', ...a),
};

function readSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(DATA_DIR, '.session-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret);
  return secret;
}

export const settings = {
  port: Number(process.env.PORT) || 4000,
  host: process.env.HOST || '127.0.0.1',
  appPassword: process.env.APP_PASSWORD || '',
  mcpToken: process.env.MCP_TOKEN || '',
  sessionSecret: readSecret(),
  syncIntervalSec: Number(process.env.SYNC_INTERVAL_SEC) || 120,
  syncConcurrency: Number(process.env.SYNC_CONCURRENCY) || 6,
  inboxDepth: Number(process.env.INBOX_DEPTH) || 60,
  sentDepth: Number(process.env.SENT_DEPTH) || 30,
  maxConnections: Number(process.env.MAX_IMAP_CONNECTIONS) || 100,
};

const MAILBOX_FILE = process.env.MAILBOXES_FILE
  ? path.resolve(ROOT, process.env.MAILBOXES_FILE)
  : path.join(ROOT, 'config', 'mailboxes.json');

/**
 * Mailboxes come from the MAILBOXES_JSON env var when set (plain JSON or base64 — used on hosting
 * platforms, where config/mailboxes.json is not deployed), otherwise from config/mailboxes.json.
 */
function readMailboxConfig() {
  const env = process.env.MAILBOXES_JSON?.trim();
  if (env) {
    const text = env.startsWith('{') || env.startsWith('[') ? env : Buffer.from(env, 'base64').toString('utf8');
    return JSON.parse(text);
  }
  if (!fs.existsSync(MAILBOX_FILE)) return null;
  return JSON.parse(fs.readFileSync(MAILBOX_FILE, 'utf8'));
}

function loadAccounts() {
  const raw = readMailboxConfig();
  if (!raw) {
    log.warn(`No mailboxes configured. Set MAILBOXES_JSON or run: npm run import -- "<sheet.csv>" --batch 1`);
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw.mailboxes || [];
  return list.map((m, i) => {
    const email = String(m.email).toLowerCase();
    const slot = String(m.slot || `${i + 1}A`).toUpperCase();
    return {
      slot,
      sno: m.sno ?? i + 1,
      // Batch from the config, else from the slot letter (1A -> batch 1, 1B -> batch 2).
      batch: Number(m.batch) || Math.max(1, slot.slice(-1).charCodeAt(0) - 64),
      name: m.name || email,
      firstName: m.firstName || (m.name || '').split(' ')[0] || '',
      lastName: m.lastName || '',
      gender: m.gender || '',
      designation: m.designation || '',
      domain: m.domain || email.split('@')[1],
      email,
      password: m.password,
      imap: m.imap || { host: m.imap_host, port: m.imap_port || 993, secure: true },
      smtp: m.smtp || { host: m.smtp_host, port: m.smtp_port || 465, secure: (m.smtp_port || 465) === 465 },
    };
  });
}

export const accounts = loadAccounts();
const bySlot = new Map(accounts.map((a) => [a.slot, a]));

export const batches = [...new Set(accounts.map((a) => a.batch))].sort((a, b) => a - b);

/** Accounts in the given batch (number or "1"/"batch 2"); all accounts when batch is empty or "all". */
export function accountsInBatch(batch) {
  if (batch === undefined || batch === null || batch === '' || String(batch).toLowerCase() === 'all') return accounts;
  const n = Number(String(batch).replace(/\D/g, ''));
  if (!batches.includes(n)) throw Object.assign(new Error(`Unknown batch "${batch}". Available: ${batches.join(', ')}`), { status: 400 });
  return accounts.filter((a) => a.batch === n);
}

/** Public view of an account — never includes the password. */
export function publicAccount(a) {
  const { password, imap, smtp, ...rest } = a;
  return rest;
}

export function getAccount(slot) {
  const a = bySlot.get(String(slot).toUpperCase());
  if (!a) throw Object.assign(new Error(`Unknown mailbox slot "${slot}"`), { status: 404 });
  return a;
}

/**
 * Resolve a loose reference ("1A", "1a", "slot 1", "ia", "william", "William Collins",
 * "name@domain.com", "askcruzai.com") to an account.
 * Returns { account } on a unique match, or { matches } when ambiguous / not found.
 */
export function resolveAccount(query) {
  const q = String(query || '').trim().toLowerCase().replace(/^slot\s*(id)?\s*[:#-]?\s*/, '');
  if (!q) return { matches: [] };

  const slotLike = (s) => {
    // Accept common typos of the slot id: "ia" / "la" -> "1A", "o" -> "0".
    if (!/^[0-9ilo]+[a-z]?$/.test(s)) return null;
    const digits = s.replace(/[a-z]$/, '').replace(/[il]/g, '1').replace(/o/g, '0');
    const letter = /[a-z]$/.test(s) && !/[ilo]$/.test(s) ? s.slice(-1) : 'a';
    return `${Number(digits)}${letter}`.toUpperCase();
  };

  const exact = bySlot.get(q.toUpperCase()) || bySlot.get(slotLike(q) || '');
  if (exact) return { account: exact };

  const tests = [
    (a) => a.email === q,
    (a) => a.email.split('@')[0] === q,
    (a) => a.domain === q || a.domain.replace(/\.[a-z]+$/, '') === q,
    (a) => a.name.toLowerCase() === q,
    (a) => a.firstName.toLowerCase() === q,
    (a) => a.name.toLowerCase().includes(q) || a.email.includes(q),
  ];
  for (const t of tests) {
    const found = accounts.filter(t);
    if (found.length === 1) return { account: found[0] };
    if (found.length > 1) return { matches: found };
  }
  return { matches: [] };
}

/**
 * Expand a list of mailbox references into accounts. Each item may be a slot ("3B"), a range
 * ("1A-5A", "1-6"), a comma list ("1A, 4A, 7B"), an email, a name or a domain.
 */
export function expandMailboxRefs(refs) {
  const items = (Array.isArray(refs) ? refs : [refs]).flatMap((r) => String(r).split(/[,;]/)).map((s) => s.trim()).filter(Boolean);
  const out = new Map();
  for (const item of items) {
    if (item.toLowerCase() === 'all') return accounts;
    const { slots, unknown } = parseSlotSelection(item, accounts);
    if (slots.length && !unknown.length) {
      slots.forEach((s) => out.set(s, bySlot.get(s)));
      continue;
    }
    const a = requireAccount(item);
    out.set(a.slot, a);
  }
  return [...out.values()];
}

export function requireAccount(query) {
  const r = resolveAccount(query);
  if (r.account) return r.account;
  const hint = r.matches.length
    ? `Ambiguous — matches: ${r.matches.map((a) => `${a.slot} (${a.email})`).join(', ')}`
    : 'No mailbox matches. Use a slot id like "1A", an email address, or a name.';
  throw Object.assign(new Error(`Could not resolve mailbox "${query}". ${hint}`), { status: 400 });
}
