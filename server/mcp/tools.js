import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ROOT, accounts, accountsInBatch, batches, requireAccount, resolveAccount, getAccount, expandMailboxRefs } from '../config.js';
import { mapLimit } from '../mail/pool.js';
import * as mail from '../mail/service.js';
import * as store from '../mail/store.js';

const batchSummary = batches
  .map((b) => {
    const list = accounts.filter((a) => a.batch === b);
    return `batch ${b} = slots ${list[0]?.slot}–${list.at(-1)?.slot} (${list.length} mailboxes)`;
  })
  .join('; ');

const INSTRUCTIONS = `AskCruz Mailbox gives access to ${accounts.length} AskCruz email accounts (SpaceMail).
Each mailbox has a slot id from the team sheet. Mailboxes are grouped in batches: ${batchSummary}.
The slot letter is the batch: "1A" is mailbox 1 of batch 1, "1B" is mailbox 1 of batch 2.
Most listing/search tools accept a "batch" argument (1, 2, …) and a "mailboxes" list that takes slots
and ranges, e.g. ["1A-5A"] for the first five mailboxes of batch 1 or ["1A","4A","7B"] for a custom set.
When the user says "send from 1A" / "from slot 14" / "from ia" / "from William", pass that text as the mailbox
argument — it is resolved to the right account (slot id, typo like "ia" = 1A, first name, email, or domain).
Email ids look like "1A:inbox:123" (slot:folder:uid); pass them to read_email, reply_to_email, forward_email, update_emails.
Always confirm the sender mailbox, recipients and content with the user before calling send_email, reply_to_email or forward_email.`;

const FOLDERS = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash'];

// ---------- helpers ----------

function parseWhen(v) {
  if (!v) return undefined;
  const s = String(v).trim().toLowerCase();
  const now = new Date();
  if (s === 'today') { now.setHours(0, 0, 0, 0); return now; }
  if (s === 'yesterday') { now.setHours(0, 0, 0, 0); now.setDate(now.getDate() - 1); return now; }
  const rel = s.match(/^(\d+)\s*(h|hours?|d|days?|w|weeks?|m|months?)$/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2][0];
    const ms = { h: 3600e3, d: 86400e3, w: 7 * 86400e3, m: 30 * 86400e3 }[unit];
    return new Date(Date.now() - n * ms);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error(`Could not understand date "${v}". Use ISO dates or forms like "7d", "24h", "today".`);
  return d;
}

/** Resolve an optional list of mailbox refs (slots, ranges like "1A-5A", names, emails) within a batch. */
function targetsFor(refs, batch) {
  const pool = accountsInBatch(batch);
  if (!refs || (Array.isArray(refs) && !refs.length)) return pool;
  const inPool = new Set(pool.map((a) => a.slot));
  return expandMailboxRefs(refs).filter((a) => inPool.has(a.slot));
}

const mailboxesArg = z
  .array(z.string())
  .optional()
  .describe('A set of mailboxes: slots ("1A", "3B"), ranges ("1A-5A", "1-6"), emails or names. Omit for all.');

const who = (a) => (a?.name ? `${a.name} <${a.address}>` : a?.address || 'unknown');
const when = (iso) => new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

function formatSummary(m) {
  const acct = accounts.find((a) => a.slot === m.slot);
  const dir = m.folder === 'sent' ? `To: ${m.to.map(who).join(', ')}` : `From: ${who(m.from)}`;
  const flags = [!m.seen && 'UNREAD', m.flagged && 'STARRED', m.answered && 'REPLIED', m.attachments && `${m.attachments} attachment(s)`]
    .filter(Boolean)
    .join(', ');
  return [
    `• [${m.id}] ${m.subject}`,
    `  ${dir} | Mailbox: ${m.slot} ${acct?.email || ''} | ${when(m.date)}${flags ? ` | ${flags}` : ''}`,
    m.snippet ? `  "${m.snippet.slice(0, 160)}"` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const text = (s) => ({ content: [{ type: 'text', text: s }] });

function wrap(fn) {
  return async (args) => {
    try {
      return await fn(args || {});
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  };
}

const batchArg = z
  .union([z.number(), z.string()])
  .optional()
  .describe(`Limit to one batch of mailboxes (${batches.join(', ')}). Omit for all batches.`);

const mailboxArg = z
  .string()
  .describe('Mailbox reference: slot id ("1A", "14a", "ia"), first/full name, email address or domain');

// ---------- brand icon ----------

// Advertised in the MCP handshake so clients show the AskCruz icon. The hosted URL is listed
// first when PUBLIC_URL is set; the embedded data URI works for local (stdio) clients too.
let iconCache;
function brandIcons() {
  if (iconCache) return iconCache;
  const icons = [];
  const base = process.env.PUBLIC_URL?.replace(/\/$/, '');
  if (base) {
    icons.push({ src: `${base}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] });
    icons.push({ src: `${base}/icon-192.png`, mimeType: 'image/png', sizes: ['192x192'] });
  }
  try {
    const png = fs.readFileSync(path.join(ROOT, 'public', 'mcp-icon.png'));
    icons.push({ src: `data:image/png;base64,${png.toString('base64')}`, mimeType: 'image/png', sizes: ['128x128'] });
  } catch {}
  return (iconCache = icons);
}

// ---------- server ----------

export function createMcpServer() {
  const server = new McpServer(
    {
      name: 'askcruz-mailbox',
      title: 'AskCruz Mailbox',
      version: '1.0.0',
      description: 'Read, search and send email from every AskCruz mailbox by slot (1A, 2B, …).',
      icons: brandIcons(),
      ...(process.env.PUBLIC_URL && { websiteUrl: process.env.PUBLIC_URL }),
    },
    { instructions: INSTRUCTIONS },
  );

  server.registerTool(
    'list_mailboxes',
    {
      title: 'List mailboxes',
      description: 'List AskCruz mailboxes with slot id, owner name, designation, email and unread count. Optionally filter by a query (slot, name, email, domain).',
      inputSchema: {
        query: z.string().optional().describe('Optional filter, e.g. "1A", "1B", "william", "askcruzai"'),
        batch: batchArg,
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ query, batch }) => {
      let list = store.accountOverview(batch);
      if (query) {
        const r = resolveAccount(query);
        const slots = new Set((r.account ? [r.account] : r.matches).map((a) => a.slot));
        list = list.filter((a) => slots.has(a.slot));
      }
      if (!list.length) return text(`No mailbox matches "${query}".`);
      return text(
        list
          .map((a) => `${a.slot.padEnd(4)} [batch ${a.batch}] ${[a.name, a.designation, a.email].filter(Boolean).join(' — ')}${a.lastSync ? ` — ${a.unread} unread` : ''}${a.status === 'error' ? ` — ERROR: ${a.error}` : ''}`)
          .join('\n'),
      );
    }),
  );

  server.registerTool(
    'inbox_overview',
    {
      title: 'Inbox overview',
      description: 'Summary across all mailboxes: total unread, which mailboxes have unread mail, top senders, and recent human replies. Good first call for "what\'s new?"',
      inputSchema: {
        refresh: z.boolean().optional().describe('Force a fresh sync of all mailboxes first (slower)'),
        batch: batchArg,
        mailboxes: mailboxesArg,
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ refresh, batch, mailboxes }) => {
      if (refresh) await store.syncAll();
      else await store.ensureFresh(300);
      const slots = mailboxes?.length ? targetsFor(mailboxes, batch).map((a) => a.slot) : undefined;
      const s = store.stats(batch, slots);
      const unread = store.accountOverview(batch).filter((a) => (!slots || slots.includes(a.slot)) && a.unread > 0).sort((a, b) => b.unread - a.unread);
      const replies = store.queryMessages({ view: 'inbox', batch, slots, limit: 200 }).messages
        .filter((m) => /^re:/i.test(m.subject) && !accounts.some((a) => a.email === m.from.address))
        .slice(0, 10);
      return text(
        [
          `${batch ? `Batch ${batch} — ` : ''}Mailboxes: ${s.mailboxes} (${s.healthy} connected${s.failing.length ? `, ${s.failing.length} failing: ${s.failing.map((f) => f.slot).join(', ')}` : ''})`,
          `Total unread: ${s.unread}`,
          '',
          'Unread by mailbox:',
          ...(unread.length ? unread.map((a) => `  ${a.slot} ${a.name} (${a.email}): ${a.unread}`) : ['  none']),
          '',
          'Top senders (recent inbox window):',
          ...s.topSenders.map((t) => `  ${who(t)} — ${t.count} email(s) to ${t.slots.join(', ')}`),
          '',
          'Latest replies received:',
          ...(replies.length ? replies.map(formatSummary) : ['  none']),
        ].join('\n'),
      );
    }),
  );

  server.registerTool(
    'list_emails',
    {
      title: 'List emails',
      description: 'List the most recent emails, newest first. Without a mailbox it returns a unified list across ALL mailboxes. Use to answer "what did I receive", "latest emails in 3A", "what did 5A send".',
      inputSchema: {
        mailbox: mailboxArg.optional().describe('One mailbox to list (slot/name/email). Omit for all mailboxes.'),
        mailboxes: mailboxesArg,
        folder: z.enum(FOLDERS).optional().describe('Folder, default inbox'),
        unread_only: z.boolean().optional(),
        since: z.string().optional().describe('Only emails after this: ISO date, "today", "yesterday", "7d", "24h"'),
        batch: batchArg,
        limit: z.number().int().min(1).max(100).optional().describe('Default 20'),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ mailbox, mailboxes, folder = 'inbox', unread_only, since, batch, limit = 20 }) => {
      const sinceDate = parseWhen(since);
      let list;
      if (mailbox) {
        const account = requireAccount(mailbox);
        if (unread_only || sinceDate) {
          list = await mail.searchMessages(account, folder, { unseen: unread_only, since: sinceDate }, limit);
        } else {
          list = (await mail.listMessages(account, folder, { limit })).messages;
        }
      } else {
        if (!['inbox', 'sent'].includes(folder)) throw new Error('Cross-mailbox listing supports inbox and sent. Pass a mailbox for other folders.');
        await store.ensureFresh(300);
        const slots = mailboxes?.length ? targetsFor(mailboxes, batch).map((a) => a.slot) : undefined;
        list = store.queryMessages({ view: folder, batch, slots, limit: 5000 }).messages;
        if (unread_only) list = list.filter((m) => !m.seen);
        if (sinceDate) list = list.filter((m) => new Date(m.date) >= sinceDate);
        list = list.slice(0, limit);
      }
      if (!list.length) return text('No emails found.');
      return text(`${list.length} email(s):\n\n${list.map(formatSummary).join('\n\n')}`);
    }),
  );

  server.registerTool(
    'search_emails',
    {
      title: 'Search emails',
      description: 'Search emails on the mail server by sender, recipient, subject, body text and date, across one, several, or all mailboxes. Use for "did anyone from acme.com reply?", "emails from rajat@eoxs.com", "who wrote about pricing?".',
      inputSchema: {
        mailboxes: mailboxesArg,
        batch: batchArg,
        from: z.string().optional().describe('Sender address, name or domain fragment'),
        to: z.string().optional().describe('Recipient address fragment'),
        subject: z.string().optional(),
        text: z.string().optional().describe('Words in the body or headers'),
        since: z.string().optional().describe('ISO date, "today", "7d", "24h", ...'),
        before: z.string().optional(),
        unread_only: z.boolean().optional(),
        folder: z.enum(FOLDERS).optional().describe('Default inbox'),
        limit: z.number().int().min(1).max(100).optional().describe('Max results overall, default 25'),
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async (a) => {
      const targets = targetsFor(a.mailboxes, a.batch);
      const limit = a.limit || 25;
      const criteria = { from: a.from, to: a.to, subject: a.subject, text: a.text, since: parseWhen(a.since), before: parseWhen(a.before), unseen: a.unread_only };
      const results = await mapLimit(targets, 16, (acct) => mail.searchMessages(acct, a.folder || 'inbox', criteria, limit));
      const found = results.flatMap((r) => (r.ok ? r.value : [])).sort((x, y) => new Date(y.date) - new Date(x.date));
      const failed = results.map((r, i) => (!r.ok ? `${targets[i].slot}: ${r.error.message}` : null)).filter(Boolean);
      const lines = found.slice(0, limit).map(formatSummary);
      return text(
        [`Searched ${targets.length} mailbox(es): ${found.length} match(es)${found.length > limit ? `, showing ${limit}` : ''}.`, '', ...lines, failed.length ? `\nFailed: ${failed.join('; ')}` : '']
          .join('\n')
          .trim(),
      );
    }),
  );

  server.registerTool(
    'list_senders',
    {
      title: 'Who emailed me',
      description: 'Aggregate who sent emails to the mailboxes: unique senders with counts, latest subject and which slots received them. Use for "from whom did I receive emails this week?".',
      inputSchema: {
        mailbox: mailboxArg.optional().describe('Limit to one mailbox; omit for all'),
        mailboxes: mailboxesArg,
        since: z.string().optional().describe('ISO date, "today", "7d", ... Default 7d'),
        exclude_internal: z.boolean().optional().describe('Hide emails sent between AskCruz mailboxes (default true)'),
        batch: batchArg,
      },
      annotations: { readOnlyHint: true },
    },
    wrap(async ({ mailbox, mailboxes, since = '7d', exclude_internal = true, batch }) => {
      const sinceDate = parseWhen(since);
      const targets = mailbox ? [requireAccount(mailbox)] : targetsFor(mailboxes, batch);
      const results = await mapLimit(targets, 16, (acct) => mail.searchMessages(acct, 'inbox', { since: sinceDate }, 200));
      const own = new Set(accounts.map((x) => x.email));
      const senders = new Map();
      for (const m of results.flatMap((r) => (r.ok ? r.value : []))) {
        if (exclude_internal && own.has(m.from.address)) continue;
        const s = senders.get(m.from.address) || { ...m.from, count: 0, unread: 0, latest: m, slots: new Set() };
        s.count++;
        if (!m.seen) s.unread++;
        s.slots.add(m.slot);
        if (m.date > s.latest.date) s.latest = m;
        senders.set(m.from.address, s);
      }
      const list = [...senders.values()].sort((a, b) => (b.latest.date > a.latest.date ? 1 : -1));
      if (!list.length) return text(`No emails received since ${sinceDate.toISOString().slice(0, 10)}.`);
      return text(
        [`${list.length} sender(s) since ${sinceDate.toISOString().slice(0, 10)}:`, '']
          .concat(list.map((s) => `• ${who(s)} — ${s.count} email(s)${s.unread ? `, ${s.unread} unread` : ''} → ${[...s.slots].join(', ')}\n  latest: "${s.latest.subject}" [${s.latest.id}] ${when(s.latest.date)}`))
          .join('\n'),
      );
    }),
  );

  server.registerTool(
    'read_email',
    {
      title: 'Read email',
      description: 'Read the full content of an email by its id (e.g. "1A:inbox:123"), including headers, body text and attachment names.',
      inputSchema: {
        id: z.string().describe('Email id from list/search results'),
        mark_as_read: z.boolean().optional().describe('Default true'),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    wrap(async ({ id, mark_as_read = true }) => {
      const { slot, folderKey, uid } = mail.parseId(id);
      const account = getAccount(slot);
      const m = await mail.getMessage(account, folderKey, uid, { markSeen: mark_as_read });
      if (mark_as_read) store.patchCached(slot, folderKey, [uid], { seen: true });
      const body = (m.text || '').trim();
      return text(
        [
          `Id: ${m.id}`,
          `Mailbox: ${account.slot} — ${account.name} <${account.email}>`,
          `Date: ${when(m.date)}`,
          `From: ${who(m.from)}`,
          `To: ${m.to.map(who).join(', ')}`,
          m.cc.length ? `Cc: ${m.cc.map(who).join(', ')}` : null,
          `Subject: ${m.subject}`,
          m.attachments.length ? `Attachments: ${m.attachments.map((a) => `${a.filename} (${Math.round(a.size / 1024)} KB)`).join(', ')}` : null,
          '',
          body.length > 20000 ? `${body.slice(0, 20000)}\n\n[truncated]` : body || '(empty body)',
        ]
          .filter((l) => l !== null)
          .join('\n'),
      );
    }),
  );

  server.registerTool(
    'send_email',
    {
      title: 'Send email',
      description: 'Send a new email FROM a specific AskCruz mailbox (e.g. from slot "1A"). Confirm details with the user before sending.',
      inputSchema: {
        from: mailboxArg.describe('Sender mailbox: slot id ("1A"), name or email'),
        to: z.array(z.string()).min(1).describe('Recipient email addresses'),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string(),
        body: z.string().describe('Plain-text body. Blank lines separate paragraphs.'),
        html: z.string().optional().describe('Optional HTML body (overrides the plain-text rendering)'),
        signature: z.boolean().optional().describe('Append the mailbox owner signature (name, designation, domain). Default false'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    wrap(async (a) => {
      const account = requireAccount(a.from);
      const r = await mail.sendMail(account, { to: a.to, cc: a.cc, bcc: a.bcc, subject: a.subject, text: a.body, html: a.html, signature: a.signature });
      store.syncAccount(account);
      return text(`Sent from ${account.slot} (${account.name} <${account.email}>) to ${r.to.join(', ')}.\nSubject: ${r.subject}\nMessage-ID: ${r.messageId}${r.rejected?.length ? `\nRejected: ${r.rejected.join(', ')}` : ''}`);
    }),
  );

  server.registerTool(
    'reply_to_email',
    {
      title: 'Reply to email',
      description: 'Reply to an email (threaded, quoted) from the mailbox that received it. Confirm with the user before sending.',
      inputSchema: {
        id: z.string().describe('Email id, e.g. "1A:inbox:123"'),
        body: z.string().describe('Reply text'),
        reply_all: z.boolean().optional(),
        cc: z.array(z.string()).optional(),
        signature: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    wrap(async ({ id, body, reply_all, cc, signature }) => {
      const { slot, folderKey, uid } = mail.parseId(id);
      const account = getAccount(slot);
      const r = await mail.replyToMessage(account, folderKey, uid, { text: body, replyAll: reply_all, cc, signature });
      store.patchCached(slot, folderKey, [uid], { answered: true });
      store.syncAccount(account);
      return text(`Reply sent from ${account.slot} (${account.email}) to ${r.to.join(', ')}.\nSubject: ${r.subject}`);
    }),
  );

  server.registerTool(
    'forward_email',
    {
      title: 'Forward email',
      description: 'Forward an email (with attachments) from the mailbox that holds it. Confirm with the user before sending.',
      inputSchema: {
        id: z.string(),
        to: z.array(z.string()).min(1),
        note: z.string().optional().describe('Text to put above the forwarded message'),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    wrap(async ({ id, to, note }) => {
      const { slot, folderKey, uid } = mail.parseId(id);
      const account = getAccount(slot);
      const r = await mail.forwardMessage(account, folderKey, uid, { to, text: note || '' });
      return text(`Forwarded from ${account.slot} (${account.email}) to ${r.to.join(', ')}.`);
    }),
  );

  server.registerTool(
    'update_emails',
    {
      title: 'Update emails',
      description: 'Mark emails read/unread, star/unstar, or move them (archive, trash, junk, inbox). All ids must be from the same folder of the same mailbox, or are processed per mailbox.',
      inputSchema: {
        ids: z.array(z.string()).min(1),
        read: z.boolean().optional(),
        starred: z.boolean().optional(),
        move_to: z.enum(['inbox', 'archive', 'trash', 'junk']).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    wrap(async ({ ids, read, starred, move_to }) => {
      const groups = new Map();
      for (const id of ids) {
        const p = mail.parseId(id);
        const k = `${p.slot}:${p.folderKey}`;
        if (!groups.has(k)) groups.set(k, { ...p, uids: [] });
        groups.get(k).uids.push(p.uid);
      }
      const done = [];
      for (const g of groups.values()) {
        const account = getAccount(g.slot);
        if (read !== undefined || starred !== undefined) {
          await mail.setFlags(account, g.folderKey, g.uids, { seen: read, flagged: starred });
          store.patchCached(g.slot, g.folderKey, g.uids, { ...(read !== undefined && { seen: read }), ...(starred !== undefined && { flagged: starred }) });
        }
        if (move_to) {
          if (move_to === 'trash') await mail.deleteMessages(account, g.folderKey, g.uids);
          else await mail.moveMessages(account, g.folderKey, g.uids, move_to);
          store.patchCached(g.slot, g.folderKey, g.uids, null);
        }
        done.push(`${g.slot}/${g.folderKey}: ${g.uids.length}`);
      }
      return text(`Updated ${ids.length} email(s) (${done.join(', ')}).`);
    }),
  );

  return server;
}
