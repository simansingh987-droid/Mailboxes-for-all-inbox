// Writes data/hosting.env with the environment variables a hosting platform needs.
// MAILBOXES_JSON carries every mailbox (including passwords) as base64 — keep the file private
// and paste the values into your host's secret/env settings. Never commit it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const file = path.join(root, 'config', 'mailboxes.json');
if (!fs.existsSync(file)) {
  console.error('config/mailboxes.json not found. Import your mailboxes first.');
  process.exit(1);
}
const { mailboxes } = JSON.parse(fs.readFileSync(file, 'utf8'));
const b64 = Buffer.from(JSON.stringify({ mailboxes })).toString('base64');

const lines = [
  `MAILBOXES_JSON=${b64}`,
  `APP_PASSWORD=${process.env.APP_PASSWORD || crypto.randomBytes(9).toString('base64url')}`,
  `MCP_TOKEN=${process.env.MCP_TOKEN || crypto.randomBytes(24).toString('base64url')}`,
  `SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`,
  'HOST=0.0.0.0',
  'SYNC_CONCURRENCY=8',
  'MAX_IMAP_CONNECTIONS=100',
];
const out = path.join(root, 'data', 'hosting.env');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`Wrote ${path.relative(root, out)} (${mailboxes.length} mailboxes, ${Math.round(b64.length / 1024)} KB). Keep it private.`);
