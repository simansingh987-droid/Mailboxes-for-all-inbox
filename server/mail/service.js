import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { simpleParser } from 'mailparser';
import { withImap } from './pool.js';
import { log } from '../config.js';

export const FOLDER_KEYS = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash'];

const SPECIAL_USE = {
  '\\Inbox': 'inbox', '\\Sent': 'sent', '\\Drafts': 'drafts',
  '\\Archive': 'archive', '\\Junk': 'junk', '\\Trash': 'trash',
};
const NAME_GUESS = [
  ['sent', /^(sent|sent items|sent mail|sent messages|inbox[./]sent)$/i],
  ['drafts', /^(drafts?|inbox[./]drafts?)$/i],
  ['archive', /^(archive|archives|all mail|inbox[./]archive)$/i],
  ['junk', /^(junk|spam|junk e-?mail|bulk mail|inbox[./](junk|spam))$/i],
  ['trash', /^(trash|deleted|deleted items|deleted messages|bin|inbox[./]trash)$/i],
];

// ---------- folders ----------

const folderCache = new Map(); // slot -> { at, map, list }

export async function getFolders(account, { refresh = false } = {}) {
  const hit = folderCache.get(account.slot);
  if (hit && !refresh && Date.now() - hit.at < 30 * 60 * 1000) return hit;
  const list = await withImap(account, null, (c) => c.list());
  const map = { inbox: 'INBOX' };
  for (const f of list) {
    const key = SPECIAL_USE[f.specialUse];
    if (key && !map[key]) map[key] = f.path;
  }
  for (const [key, re] of NAME_GUESS) {
    if (map[key]) continue;
    const f = list.find((x) => re.test(x.path) || re.test(x.name));
    if (f) map[key] = f.path;
  }
  const entry = {
    at: Date.now(),
    map,
    list: list
      .filter((f) => !f.flags?.has('\\Noselect'))
      .map((f) => ({ path: f.path, name: f.name, key: keyForPath(map, f.path) })),
  };
  folderCache.set(account.slot, entry);
  return entry;
}

function keyForPath(map, path) {
  return Object.keys(map).find((k) => map[k] === path) || encodeFolder(path);
}

/** Custom folders are addressed as "x-<base64url(path)>". */
export function encodeFolder(path) {
  return `x-${Buffer.from(path).toString('base64url')}`;
}

export async function resolveFolder(account, folderKey = 'inbox') {
  if (folderKey.startsWith('x-')) return Buffer.from(folderKey.slice(2), 'base64url').toString();
  const { map } = await getFolders(account);
  if (map[folderKey]) return map[folderKey];
  if (folderKey === 'archive') return null; // created lazily on first archive
  throw Object.assign(new Error(`Mailbox ${account.slot} has no "${folderKey}" folder`), { status: 404 });
}

// ---------- message ids ----------

export function makeId(slot, folderKey, uid) {
  return `${slot}:${folderKey}:${uid}`;
}

export function parseId(id) {
  const [slot, folderKey, uid] = String(id).split(':');
  if (!slot || !folderKey || !Number(uid)) {
    throw Object.assign(new Error(`Invalid message id "${id}"`), { status: 400 });
  }
  return { slot, folderKey, uid: Number(uid) };
}

// ---------- summaries ----------

const addr = (a) => ({ name: a?.name || '', address: (a?.address || '').toLowerCase() });

function walkParts(node, fn) {
  if (!node) return;
  fn(node);
  (node.childNodes || []).forEach((c) => walkParts(c, fn));
}

function attachmentInfo(bodyStructure) {
  let count = 0;
  walkParts(bodyStructure, (p) => {
    const filename = p.dispositionParameters?.filename || p.parameters?.name;
    if (p.disposition === 'attachment' || (filename && !String(p.type).startsWith('multipart/'))) count++;
  });
  return count;
}

function safeIso(d) {
  const t = d ? new Date(d) : null;
  return t && !Number.isNaN(t.getTime()) ? t.toISOString() : new Date(0).toISOString();
}

export function toSummary(msg, account, folderKey) {
  const env = msg.envelope || {};
  const flags = msg.flags || new Set();
  return {
    id: makeId(account.slot, folderKey, msg.uid),
    slot: account.slot,
    account: account.email,
    folder: folderKey,
    uid: msg.uid,
    messageId: env.messageId || null,
    inReplyTo: env.inReplyTo || null,
    subject: env.subject || '(no subject)',
    from: addr(env.from?.[0]),
    to: (env.to || []).map(addr),
    cc: (env.cc || []).map(addr),
    date: safeIso(env.date || msg.internalDate),
    seen: flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    answered: flags.has('\\Answered'),
    attachments: attachmentInfo(msg.bodyStructure),
    size: msg.size || 0,
    snippet: '',
  };
}

export function htmlToText(html = '') {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function makeSnippet(parsed) {
  const text = (parsed.text || htmlToText(parsed.html || '')).split(/\n?\s*On [\s\S]{5,200}?wrote:/)[0];
  return text
    .split('\n')
    .filter((l) => !l.trim().startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

/** Fetch partial sources for the given UIDs and return uid -> snippet. */
export async function fetchSnippets(client, uids) {
  const out = new Map();
  if (!uids.length) return out;
  for await (const m of client.fetch(uids.join(','), { uid: true, source: { maxLength: 16000 } }, { uid: true })) {
    try {
      out.set(m.uid, makeSnippet(await simpleParser(m.source, { skipImageLinks: true, skipTextToHtml: true })));
    } catch {
      out.set(m.uid, '');
    }
  }
  return out;
}

const SUMMARY_QUERY = { uid: true, flags: true, envelope: true, bodyStructure: true, internalDate: true, size: true };

/** Newest-first list of message summaries in a folder. */
export async function listMessages(account, folderKey = 'inbox', { limit = 30, beforeUid } = {}) {
  const path = await resolveFolder(account, folderKey);
  if (!path) return { messages: [], total: 0 };
  return withImap(account, path, async (client) => {
    const total = client.mailbox.exists;
    if (!total) return { messages: [], total: 0 };
    let uids = await client.search({ all: true }, { uid: true });
    uids = (uids || []).sort((a, b) => b - a);
    if (beforeUid) uids = uids.filter((u) => u < beforeUid);
    uids = uids.slice(0, limit);
    if (!uids.length) return { messages: [], total };
    const messages = [];
    for await (const m of client.fetch(uids.join(','), SUMMARY_QUERY, { uid: true })) {
      messages.push(toSummary(m, account, folderKey));
    }
    const snippets = await fetchSnippets(client, uids);
    messages.forEach((m) => (m.snippet = snippets.get(m.uid) || ''));
    messages.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { messages, total };
  });
}

/**
 * Server-side IMAP search in one mailbox folder.
 * criteria: { from, to, subject, text, since, before, unseen, flagged }
 */
export async function searchMessages(account, folderKey = 'inbox', criteria = {}, limit = 25) {
  const path = await resolveFolder(account, folderKey);
  if (!path) return [];
  const q = {};
  if (criteria.from) q.from = criteria.from;
  if (criteria.to) q.to = criteria.to;
  if (criteria.subject) q.subject = criteria.subject;
  if (criteria.text) q.text = criteria.text;
  if (criteria.since) q.since = new Date(criteria.since);
  if (criteria.before) q.before = new Date(criteria.before);
  if (criteria.unseen) q.seen = false;
  if (criteria.flagged) q.flagged = true;
  if (!Object.keys(q).length) q.all = true;
  return withImap(account, path, async (client) => {
    if (!client.mailbox.exists) return [];
    const uids = ((await client.search(q, { uid: true })) || []).sort((a, b) => b - a).slice(0, limit);
    if (!uids.length) return [];
    const out = [];
    for await (const m of client.fetch(uids.join(','), SUMMARY_QUERY, { uid: true })) {
      out.push(toSummary(m, account, folderKey));
    }
    const snippets = await fetchSnippets(client, uids);
    out.forEach((m) => (m.snippet = snippets.get(m.uid) || ''));
    return out.sort((a, b) => new Date(b.date) - new Date(a.date));
  });
}

// ---------- full message ----------

const bodyCache = new Map(); // id -> parsed message (small LRU)
const BODY_CACHE_MAX = 60;

async function fetchParsed(account, folderKey, uid) {
  const id = makeId(account.slot, folderKey, uid);
  if (bodyCache.has(id)) {
    const hit = bodyCache.get(id);
    bodyCache.delete(id);
    bodyCache.set(id, hit);
    return hit;
  }
  const path = await resolveFolder(account, folderKey);
  const result = await withImap(account, path, async (client) => {
    const m = await client.fetchOne(String(uid), { uid: true, source: true, flags: true, envelope: true, bodyStructure: true, internalDate: true, size: true }, { uid: true });
    if (!m) return null;
    return { summary: toSummary(m, account, folderKey), parsed: await simpleParser(m.source) };
  });
  if (!result) throw Object.assign(new Error('Message not found (it may have been moved or deleted)'), { status: 404 });
  bodyCache.set(id, result);
  if (bodyCache.size > BODY_CACHE_MAX) bodyCache.delete(bodyCache.keys().next().value);
  return result;
}

const addrList = (v) => (v?.value || []).map((a) => ({ name: a.name || '', address: (a.address || '').toLowerCase() }));

export async function getMessage(account, folderKey, uid, { markSeen = true } = {}) {
  const { summary, parsed } = await fetchParsed(account, folderKey, uid);
  if (markSeen && !summary.seen) {
    await setFlags(account, folderKey, [uid], { seen: true }).catch((e) => log.warn(e.message));
    summary.seen = true;
  }
  return {
    ...summary,
    from: addrList(parsed.from)[0] || summary.from,
    to: addrList(parsed.to),
    cc: addrList(parsed.cc),
    replyTo: addrList(parsed.replyTo),
    references: [].concat(parsed.references || []),
    html: parsed.html || null,
    text: parsed.text || (parsed.html ? htmlToText(parsed.html).replace(/\n{3,}/g, '\n\n').trim() : ''),
    snippet: makeSnippet(parsed),
    attachments: (parsed.attachments || [])
      .filter((a) => a.contentDisposition !== 'inline' || !a.cid)
      .map((a, index) => ({ index, filename: a.filename || `attachment-${index + 1}`, contentType: a.contentType, size: a.size })),
    inlineImages: (parsed.attachments || [])
      .filter((a) => a.cid && a.contentType?.startsWith('image/') && a.size < 2_000_000)
      .map((a) => ({ cid: a.cid, dataUrl: `data:${a.contentType};base64,${a.content.toString('base64')}` })),
  };
}

export async function getAttachment(account, folderKey, uid, index) {
  const { parsed } = await fetchParsed(account, folderKey, uid);
  const list = (parsed.attachments || []).filter((a) => a.contentDisposition !== 'inline' || !a.cid);
  const a = list[index];
  if (!a) throw Object.assign(new Error('Attachment not found'), { status: 404 });
  return { filename: a.filename || `attachment-${index + 1}`, contentType: a.contentType, content: a.content };
}

// ---------- flags / move / delete ----------

export async function setFlags(account, folderKey, uids, { seen, flagged, answered }) {
  const path = await resolveFolder(account, folderKey);
  const range = uids.join(',');
  await withImap(account, path, async (client) => {
    const change = async (on, flag) => {
      if (on === undefined) return;
      if (on) await client.messageFlagsAdd(range, [flag], { uid: true });
      else await client.messageFlagsRemove(range, [flag], { uid: true });
    };
    await change(seen, '\\Seen');
    await change(flagged, '\\Flagged');
    await change(answered, '\\Answered');
  });
  for (const uid of uids) {
    const hit = bodyCache.get(makeId(account.slot, folderKey, uid));
    if (hit) {
      if (seen !== undefined) hit.summary.seen = seen;
      if (flagged !== undefined) hit.summary.flagged = flagged;
    }
  }
}

async function ensureArchive(account) {
  const { map } = await getFolders(account);
  if (map.archive) return map.archive;
  await withImap(account, null, (c) => c.mailboxCreate('Archive')).catch(() => {});
  const refreshed = await getFolders(account, { refresh: true });
  return refreshed.map.archive || 'Archive';
}

export async function moveMessages(account, folderKey, uids, destKey) {
  const from = await resolveFolder(account, folderKey);
  const to = destKey === 'archive' ? await ensureArchive(account) : await resolveFolder(account, destKey);
  if (from === to) return;
  await withImap(account, from, (client) => client.messageMove(uids.join(','), to, { uid: true }));
  uids.forEach((uid) => bodyCache.delete(makeId(account.slot, folderKey, uid)));
}

/** Move to Trash, or permanently delete when already in Trash. */
export async function deleteMessages(account, folderKey, uids) {
  const { map } = await getFolders(account);
  if (folderKey === 'trash' || !map.trash) {
    const path = await resolveFolder(account, folderKey);
    await withImap(account, path, (client) => client.messageDelete(uids.join(','), { uid: true }));
    uids.forEach((uid) => bodyCache.delete(makeId(account.slot, folderKey, uid)));
    return { permanent: true };
  }
  await moveMessages(account, folderKey, uids, 'trash');
  return { permanent: false };
}

// ---------- status ----------

export async function mailboxStatus(account) {
  const { map } = await getFolders(account);
  const st = await withImap(account, null, (c) => c.status(map.inbox, { messages: true, unseen: true }));
  return { slot: account.slot, email: account.email, inbox: st.messages || 0, unread: st.unseen || 0, folders: map };
}

// ---------- sending ----------

const listify = (v) =>
  (Array.isArray(v) ? v : String(v || '').split(/[,;]/))
    .map((x) => (typeof x === 'string' ? x.trim() : x))
    .filter(Boolean);

export function signatureFor(account) {
  return [account.name, account.designation, account.domain].filter(Boolean).join('\n');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function textToHtml(text) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">${escapeHtml(text)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${p.replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`;
}

/**
 * Hand a fully built message to SMTP. Hosts that block outbound SMTP ports (e.g. Render's free
 * plan) set SMTP_RELAY_URL + RELAY_SECRET, and the message is sent by the relay function in
 * api/relay-send.js (deployed on Vercel) instead.
 */
async function deliver(account, envelope, raw) {
  const smtp = {
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure !== false,
    user: account.email,
    pass: account.password,
  };
  const relay = process.env.SMTP_RELAY_URL;
  if (relay) {
    const res = await fetch(relay, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Relay-Secret': process.env.RELAY_SECRET || '' },
      body: JSON.stringify({ smtp, envelope, raw: raw.toString('base64') }),
      signal: AbortSignal.timeout(60000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Send relay failed (${res.status})`), { status: 502 });
    return data;
  }
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 20000,
  });
  try {
    return await transport.sendMail({ envelope, raw });
  } finally {
    transport.close();
  }
}

/**
 * Send an email from a mailbox via SMTP and store a copy in its Sent folder.
 * opts: { to, cc, bcc, subject, text, html, attachments:[{filename, content(base64)|path, contentType}],
 *         inReplyTo, references, signature(bool) }
 */
export async function sendMail(account, opts) {
  const to = listify(opts.to);
  const cc = listify(opts.cc);
  const bcc = listify(opts.bcc);
  if (!to.length && !cc.length && !bcc.length) throw Object.assign(new Error('At least one recipient is required'), { status: 400 });

  let text = opts.text || (opts.html ? htmlToText(opts.html) : '');
  let html = opts.html || null;
  if (opts.signature) {
    const sig = signatureFor(account);
    text = `${text}\n\n--\n${sig}`;
    html = html ? `${html}<br><div style="color:#64748b;font-size:13px">--<br>${escapeHtml(sig).replace(/\n/g, '<br>')}</div>` : null;
  }
  if (!html && text) html = textToHtml(text);
  if (opts.quotedHtml) html += opts.quotedHtml;
  if (opts.quotedText) text += opts.quotedText;

  const mail = {
    from: { name: account.name, address: account.email },
    to, cc, bcc,
    subject: opts.subject || '',
    text,
    html,
    inReplyTo: opts.inReplyTo || undefined,
    references: opts.references || undefined,
    attachments: (opts.attachments || []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      ...(a.content ? { content: Buffer.from(a.content, 'base64') } : { path: a.path }),
    })),
  };

  const node = new MailComposer({ ...mail, bcc: [] }).compile();
  const raw = await node.build();
  const messageId = node.messageId();

  const envelope = { from: account.email, to: [...to, ...cc, ...bcc].map((x) => (typeof x === 'string' ? x : x.address)) };
  const info = await deliver(account, envelope, raw);

  // Keep a copy in Sent (SpaceMail does not store SMTP submissions automatically).
  try {
    const sent = await resolveFolder(account, 'sent');
    await withImap(account, null, (c) => c.append(sent, raw, ['\\Seen']));
  } catch (err) {
    log.warn(`Could not save sent copy for ${account.slot}: ${err.message}`);
  }

  return {
    from: account.email,
    slot: account.slot,
    to: envelope.to,
    subject: mail.subject,
    messageId: info.messageId || messageId,
    accepted: info.accepted,
    rejected: info.rejected,
  };
}

const quoteHeader = (m) =>
  `On ${new Date(m.date).toUTCString()}, ${m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address} wrote:`;

/** Reply (or reply-all) to a stored message, threading it correctly. */
export async function replyToMessage(account, folderKey, uid, { text, html, replyAll = false, attachments, signature, cc, bcc }) {
  const orig = await getMessage(account, folderKey, uid, { markSeen: false });
  const self = account.email;
  const primary = (orig.replyTo.length ? orig.replyTo : [orig.from]).map((a) => a.address);
  let to = folderKey === 'sent' ? orig.to.map((a) => a.address) : primary;
  let ccList = listify(cc);
  if (replyAll) {
    const others = [...orig.to, ...orig.cc].map((a) => a.address).filter((a) => a && a !== self && !to.includes(a));
    ccList = [...new Set([...ccList, ...others])];
  }
  to = to.filter((a) => a && a !== self);
  const subject = /^re:/i.test(orig.subject) ? orig.subject : `Re: ${orig.subject}`;
  const refs = [...orig.references, orig.messageId].filter(Boolean);

  const origText = orig.text || '';
  const quotedText = `\n\n${quoteHeader(orig)}\n${origText.split('\n').map((l) => `> ${l}`).join('\n')}`;
  const quotedHtml = `<br><div style="color:#64748b;font-size:13px">${escapeHtml(quoteHeader(orig))}</div><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #cbd5e1;padding-left:1ex">${orig.html || textToHtml(origText)}</blockquote>`;

  const result = await sendMail(account, {
    to, cc: ccList, bcc, subject, text, html, attachments, signature,
    inReplyTo: orig.messageId, references: refs, quotedText, quotedHtml,
  });
  await setFlags(account, folderKey, [uid], { answered: true }).catch(() => {});
  return result;
}

export async function forwardMessage(account, folderKey, uid, { to, cc, bcc, text = '', signature }) {
  const orig = await getMessage(account, folderKey, uid, { markSeen: false });
  const { parsed } = await fetchParsed(account, folderKey, uid);
  const header = [
    '---------- Forwarded message ---------',
    `From: ${orig.from.name ? `${orig.from.name} <${orig.from.address}>` : orig.from.address}`,
    `Date: ${new Date(orig.date).toUTCString()}`,
    `Subject: ${orig.subject}`,
    `To: ${orig.to.map((a) => a.address).join(', ')}`,
  ].join('\n');
  return sendMail(account, {
    to, cc, bcc, signature, text,
    subject: /^fwd?:/i.test(orig.subject) ? orig.subject : `Fwd: ${orig.subject}`,
    quotedText: `\n\n${header}\n\n${orig.text}`,
    quotedHtml: `<br><div style="color:#64748b;font-size:13px">${escapeHtml(header).replace(/\n/g, '<br>')}</div><br>${orig.html || textToHtml(orig.text)}`,
    attachments: (parsed.attachments || [])
      .filter((a) => a.contentDisposition !== 'inline' || !a.cid)
      .map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content.toString('base64') })),
  });
}
