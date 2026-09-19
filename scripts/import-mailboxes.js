// Adds a batch of mailboxes to config/mailboxes.json (merging with batches already imported).
// Accepts the AskCruz sheet exported as CSV, or a JSON file ({ mailboxes: [...] } or [...]).
// Usage: node scripts/import-mailboxes.js "<file.csv|file.json>" --batch 2 [--imap-host mail.spacemail.com] [--replace]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const VALUE_FLAGS = ['--batch', '--imap-host', '--smtp-host'];
const file = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]));
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

if (!file) {
  console.error('Usage: node scripts/import-mailboxes.js "<file.csv|file.json>" --batch <n> [--replace]');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** Normalise any supported input row into { slot, sno, firstName, lastName, name, ... }. */
function readRows(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '');
  if (filePath.toLowerCase().endsWith('.json')) {
    const raw = JSON.parse(text);
    return (Array.isArray(raw) ? raw : raw.mailboxes || []).map((m, i) => ({
      sno: m.sno ?? m['S.No'] ?? i + 1,
      slot: m.slot ?? m['Slot ID'] ?? '',
      firstName: m.firstName ?? m.first_name ?? '',
      lastName: m.lastName ?? m.last_name ?? '',
      name: m.name ?? m.full_name ?? '',
      gender: m.gender ?? '',
      designation: m.designation ?? '',
      domain: m.domain ?? '',
      email: m.email,
      password: m.password,
      imapHost: m.imap_host ?? m.imap?.host,
      imapPort: m.imap_port ?? m.imap?.port,
      smtpHost: m.smtp_host ?? m.smtp?.host,
      smtpPort: m.smtp_port ?? m.smtp?.port,
    }));
  }
  const [header, ...rows] = parseCsv(text);
  const col = (name) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const get = (r, name) => { const i = col(name); return i >= 0 ? (r[i] || '').trim() : ''; };
  return rows.map((r) => ({
    sno: get(r, 'S.No'), slot: get(r, 'Slot ID'), firstName: get(r, 'First Name'), lastName: get(r, 'Last Name'),
    name: get(r, 'Full Name'), gender: get(r, 'Gender'), designation: get(r, 'Designation'), domain: get(r, 'Domain'),
    email: get(r, 'Email'), password: get(r, 'Password'),
  }));
}

const batch = Number(flag('batch', 1));
const imapHost = flag('imap-host', 'mail.spacemail.com');
const smtpHost = flag('smtp-host', imapHost);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const incoming = readRows(file)
  .filter((r) => r.email && r.password)
  .map((r, i) => {
    const email = String(r.email).trim().toLowerCase();
    const local = email.split('@')[0];
    const firstName = r.firstName || cap(local);
    const lastName = r.lastName || '';
    const letter = String.fromCharCode(64 + batch); // batch 1 -> A, 2 -> B
    return {
      slot: String(r.slot || `${Number(r.sno) || i + 1}${letter}`).toUpperCase(),
      sno: Number(r.sno) || i + 1,
      batch,
      name: r.name || `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      gender: r.gender || '',
      designation: r.designation || '',
      domain: r.domain || email.split('@')[1],
      email,
      password: String(r.password).trim(),
      imap: { host: r.imapHost || imapHost, port: Number(r.imapPort) || 993, secure: true },
      smtp: { host: r.smtpHost || smtpHost, port: Number(r.smtpPort) || 465, secure: (Number(r.smtpPort) || 465) === 465 },
    };
  });

const out = path.join(root, 'config', 'mailboxes.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
let existing = [];
if (fs.existsSync(out) && !args.includes('--replace')) {
  const raw = JSON.parse(fs.readFileSync(out, 'utf8'));
  existing = (Array.isArray(raw) ? raw : raw.mailboxes || []).map((m) => ({ ...m, batch: m.batch ?? 1 }));
}

const incomingEmails = new Set(incoming.map((m) => m.email));
const incomingSlots = new Set(incoming.map((m) => m.slot));
const kept = existing.filter((m) => !incomingEmails.has(m.email) && !incomingSlots.has(m.slot));
const clash = existing.filter((m) => incomingSlots.has(m.slot) && !incomingEmails.has(m.email));
if (clash.length) console.warn(`Replacing ${clash.length} mailbox(es) whose slot ids are reused: ${clash.map((m) => m.slot).join(', ')}`);

const mailboxes = [...kept, ...incoming].sort((a, b) => (a.batch - b.batch) || (a.sno - b.sno));
fs.writeFileSync(out, JSON.stringify({ mailboxes }, null, 2));
const counts = mailboxes.reduce((m, x) => ({ ...m, [x.batch]: (m[x.batch] || 0) + 1 }), {});
console.log(`Imported ${incoming.length} mailboxes as batch ${batch}. Total ${mailboxes.length}: ${Object.entries(counts).map(([b, n]) => `batch ${b} = ${n}`).join(', ')}`);
