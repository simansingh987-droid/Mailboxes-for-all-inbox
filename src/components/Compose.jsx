import { useEffect, useMemo, useRef, useState } from 'react';
import {
  X, Minus, Maximize2, Minimize2, Paperclip, Send, ChevronDown, Search, Signature, Trash2, FileText, Save, Check,
} from 'lucide-react';
import { api, fileToBase64 } from '../lib/api.js';
import { Spinner, useToast } from './ui.jsx';
import { bytes, displayName } from '../lib/format.js';

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const DRAFT_KEY = 'acm-draft';
const TEMPLATES_KEY = 'acm-templates';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/** Same loose matching as the server: "1a", "ia", "william", "askcruzai". */
export function matchAccounts(accounts, q) {
  const s = q.trim().toLowerCase().replace(/^slot\s*/, '');
  if (!s) return accounts;
  // "1a", "ia" -> 1A; "1b", "ib" -> 1B; a bare number defaults to batch A.
  const m = s.match(/^([0-9il]+)([a-hj-km-z])?$/);
  const slotGuess = m ? `${Number(m[1].replace(/[il]/g, '1'))}${(m[2] || 'a').toUpperCase()}` : null;
  return accounts
    .filter((a) => a.slot.toLowerCase() === s || a.slot === slotGuess || `${a.slot} ${a.name} ${a.email} ${a.designation}`.toLowerCase().includes(s))
    .sort((a, b) => (b.slot === slotGuess || b.slot.toLowerCase() === s) - (a.slot === slotGuess || a.slot.toLowerCase() === s));
}

function FromPicker({ accounts, value, onChange, locked }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef(null);
  const current = accounts.find((a) => a.slot === value);
  const list = useMemo(() => matchAccounts(accounts, q), [accounts, q]);

  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => setHi(0), [q]);

  const pick = (a) => { onChange(a.slot); setOpen(false); setQ(''); };

  return (
    <div ref={ref} className="relative flex-1">
      <button
        type="button"
        disabled={locked}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-slate-50 disabled:hover:bg-transparent dark:hover:bg-white/5"
      >
        {current ? (
          <>
            <span className="slot-badge">{current.slot}</span>
            <span className="font-medium text-slate-800 dark:text-slate-100">{current.name}</span>
            <span className="truncate text-slate-400">&lt;{current.email}&gt;</span>
          </>
        ) : (
          <span className="text-slate-400">Choose a sending mailbox…</span>
        )}
        {!locked && <ChevronDown size={14} className="ml-auto text-slate-400" />}
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl animate-fade-in dark:border-ink-600 dark:bg-ink-800">
          <div className="relative border-b border-slate-100 p-2 dark:border-white/5">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              className="input py-1.5 pl-8"
              placeholder='Type a slot ("1A"), name or email'
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, list.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                if (e.key === 'Enter' && list[hi]) { e.preventDefault(); pick(list[hi]); }
                if (e.key === 'Escape') setOpen(false);
              }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {list.map((a, i) => (
              <button
                key={a.slot}
                type="button"
                onMouseEnter={() => setHi(i)}
                onClick={() => pick(a)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm ${i === hi ? 'bg-brand-50 dark:bg-white/5' : ''}`}
              >
                <span className="slot-badge">{a.slot}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-slate-400">{a.email}</span>
                </span>
                {a.slot === value && <Check size={14} className="text-brand-600" />}
              </button>
            ))}
            {!list.length && <div className="p-4 text-center text-xs text-slate-400">No mailbox matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function RecipientInput({ value, onChange, placeholder, autoFocus }) {
  const [text, setText] = useState('');
  const commit = (raw = text) => {
    const parts = raw.split(/[,;\s]+/).map((s) => s.trim().replace(/^<|>$/g, '')).filter(Boolean);
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])]);
    setText('');
  };
  return (
    <div className="flex flex-1 flex-wrap items-center gap-1 py-0.5">
      {value.map((r) => (
        <span key={r} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${EMAIL_RE.test(r) ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/50 dark:text-brand-200' : 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300'}`}>
          {r}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== r))} className="opacity-60 hover:opacity-100"><X size={11} /></button>
        </span>
      ))}
      <input
        autoFocus={autoFocus}
        className="min-w-[140px] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-slate-400"
        placeholder={value.length ? '' : placeholder}
        value={text}
        onChange={(e) => (/[,;\s]$/.test(e.target.value) ? commit(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text) { e.preventDefault(); commit(); }
          if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => commit()}
        onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[,;\s]/.test(t)) { e.preventDefault(); commit(t); } }}
      />
    </div>
  );
}

function fillTemplate(text, account) {
  if (!account) return text;
  return text
    .replaceAll('{{sender_name}}', account.name)
    .replaceAll('{{sender_first}}', account.firstName || account.name.split(' ')[0])
    .replaceAll('{{designation}}', account.designation || '')
    .replaceAll('{{domain}}', account.domain || '')
    .replaceAll('{{email}}', account.email);
}

export default function Compose({ init, accounts, onClose, onSent }) {
  const mode = init.mode || 'new'; // new | reply | replyAll | forward
  const isReply = mode === 'reply' || mode === 'replyAll';
  const saved = mode === 'new' && !init.from && !init.to ? load(DRAFT_KEY, null) : null;

  const [from, setFrom] = useState(init.from || saved?.from || accounts[0]?.slot);
  const [to, setTo] = useState(init.to || saved?.to || []);
  const [cc, setCc] = useState(init.cc || saved?.cc || []);
  const [bcc, setBcc] = useState(saved?.bcc || []);
  const [showCc, setShowCc] = useState(!!(init.cc?.length || saved?.cc?.length || saved?.bcc?.length));
  const [subject, setSubject] = useState(init.subject ?? saved?.subject ?? '');
  const [body, setBody] = useState(init.body ?? saved?.body ?? '');
  const [signature, setSignature] = useState(init.signature ?? saved?.signature ?? true);
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [size, setSize] = useState('normal'); // normal | min | max
  const [dragging, setDragging] = useState(false);
  const [templates, setTemplates] = useState(() => load(TEMPLATES_KEY, []));
  const [showTemplates, setShowTemplates] = useState(false);
  const fileRef = useRef(null);
  const toast = useToast();
  const account = accounts.find((a) => a.slot === from);

  useEffect(() => {
    if (mode !== 'new') return;
    const t = setTimeout(() => save(DRAFT_KEY, to.length || subject || body ? { from, to, cc, bcc, subject, body, signature } : null), 400);
    return () => clearTimeout(t);
  }, [mode, from, to, cc, bcc, subject, body, signature]);

  const dirty = body.trim() || (mode === 'new' && (to.length || subject));
  const close = () => {
    if (dirty && mode !== 'new' && !confirm('Discard this message?')) return;
    onClose();
  };
  const discard = () => {
    if (mode === 'new') save(DRAFT_KEY, null);
    onClose();
  };

  const addFiles = (list) => setFiles((f) => [...f, ...Array.from(list)]);
  const totalSize = files.reduce((n, f) => n + f.size, 0);

  const send = async () => {
    if (!account) return toast('Choose a sending mailbox', { type: 'error' });
    const invalid = [...to, ...cc, ...bcc].filter((r) => !EMAIL_RE.test(r));
    if (invalid.length) return toast(`Invalid address: ${invalid.join(', ')}`, { type: 'error' });
    if (!isReply && !to.length && !cc.length && !bcc.length) return toast('Add at least one recipient', { type: 'error' });
    if (!isReply && !subject.trim() && !confirm('Send without a subject?')) return;
    if (totalSize > 24 * 1024 * 1024) return toast('Attachments exceed 24 MB', { type: 'error' });
    setSending(true);
    try {
      const attachments = await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type || undefined, content: await fileToBase64(f) })));
      let r;
      if (isReply) {
        r = await api(`/messages/${encodeURIComponent(init.sourceId)}/reply`, { method: 'POST', body: { text: body, replyAll: mode === 'replyAll', cc, bcc, attachments, signature } });
      } else if (mode === 'forward') {
        r = await api(`/messages/${encodeURIComponent(init.sourceId)}/forward`, { method: 'POST', body: { to, cc, bcc, text: body, signature } });
      } else {
        r = await api('/send', { method: 'POST', body: { from, to, cc, bcc, subject, text: body, attachments, signature } });
        save(DRAFT_KEY, null);
      }
      toast(`From ${account.slot} · ${account.email} → ${r.to.join(', ')}`, { title: 'Email sent' });
      onSent?.(from);
      onClose();
    } catch (e) {
      toast(e.message, { type: 'error', title: 'Could not send' });
    } finally {
      setSending(false);
    }
  };

  const saveTemplate = () => {
    const name = prompt('Template name', subject || 'Untitled template');
    if (!name) return;
    const next = [...templates.filter((t) => t.name !== name), { name, subject, body }];
    setTemplates(next);
    save(TEMPLATES_KEY, next);
    toast(`Saved template “${name}”`, { type: 'info' });
  };

  const applyTemplate = (t) => {
    if (!isReply && t.subject) setSubject(fillTemplate(t.subject, account));
    setBody((b) => (b.trim() ? `${b}\n\n` : '') + fillTemplate(t.body, account));
    setShowTemplates(false);
  };

  const title = { new: 'New message', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward' }[mode];
  const frame =
    size === 'max'
      ? 'inset-4 sm:inset-10'
      : size === 'min'
        ? 'bottom-0 right-4 w-[320px] sm:right-8'
        : 'inset-0 sm:inset-auto sm:bottom-0 sm:right-8 sm:h-[640px] sm:max-h-[calc(100vh-40px)] sm:w-[640px]';

  return (
    <div
      className={`fixed z-50 flex flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl animate-slide-up dark:border-ink-600 dark:bg-ink-850 sm:rounded-t-2xl ${size === 'max' ? 'sm:rounded-2xl' : ''} ${frame}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
        if (e.key === 'Escape') { e.stopPropagation(); close(); }
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
    >
      <div className="brand-gradient flex cursor-default items-center gap-2 px-4 py-2.5 text-white" onDoubleClick={() => setSize(size === 'min' ? 'normal' : 'min')}>
        <img src="/logo.webp" alt="" className="h-4 brightness-0 invert" />
        <span className="flex-1 truncate text-sm font-semibold">{title}{size === 'min' && subject ? ` — ${subject}` : ''}</span>
        <button className="rounded p-1 hover:bg-white/10" onClick={() => setSize(size === 'min' ? 'normal' : 'min')}><Minus size={15} /></button>
        <button className="hidden rounded p-1 hover:bg-white/10 sm:block" onClick={() => setSize(size === 'max' ? 'normal' : 'max')}>{size === 'max' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
        <button className="rounded p-1 hover:bg-white/10" onClick={close}><X size={15} /></button>
      </div>

      {size !== 'min' && (
        <>
          <div className="divide-y divide-slate-100 px-4 dark:divide-white/5">
            <div className="flex items-center gap-2 py-1.5">
              <span className="w-12 shrink-0 text-xs font-medium text-slate-400">From</span>
              <FromPicker accounts={accounts} value={from} onChange={setFrom} locked={isReply || mode === 'forward'} />
            </div>
            {isReply ? (
              <div className="flex items-center gap-2 py-2 text-sm">
                <span className="w-12 shrink-0 text-xs font-medium text-slate-400">To</span>
                <span className="truncate text-slate-700 dark:text-slate-300">{init.replyToLabel}{mode === 'replyAll' && init.replyAllExtra ? `, ${init.replyAllExtra}` : ''}</span>
                {!showCc && <button className="ml-auto text-xs font-medium text-slate-400 hover:text-brand-600" onClick={() => setShowCc(true)}>Cc/Bcc</button>}
              </div>
            ) : (
              <div className="flex items-center gap-2 py-1">
                <span className="w-12 shrink-0 text-xs font-medium text-slate-400">To</span>
                <RecipientInput value={to} onChange={setTo} placeholder="name@company.com" autoFocus={mode === 'new' || mode === 'forward'} />
                {!showCc && <button className="text-xs font-medium text-slate-400 hover:text-brand-600" onClick={() => setShowCc(true)}>Cc/Bcc</button>}
              </div>
            )}
            {showCc && (
              <>
                <div className="flex items-center gap-2 py-1">
                  <span className="w-12 shrink-0 text-xs font-medium text-slate-400">Cc</span>
                  <RecipientInput value={cc} onChange={setCc} />
                </div>
                <div className="flex items-center gap-2 py-1">
                  <span className="w-12 shrink-0 text-xs font-medium text-slate-400">Bcc</span>
                  <RecipientInput value={bcc} onChange={setBcc} />
                </div>
              </>
            )}
            <div className="flex items-center gap-2 py-1">
              <span className="w-12 shrink-0 text-xs font-medium text-slate-400">Subject</span>
              <input className="flex-1 bg-transparent py-1.5 text-sm font-medium outline-none placeholder:font-normal placeholder:text-slate-400 disabled:text-slate-500" value={subject} onChange={(e) => setSubject(e.target.value)} disabled={isReply || mode === 'forward'} placeholder="What's this about?" />
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <textarea
              autoFocus={isReply}
              className="h-full w-full resize-none bg-transparent px-4 py-3 text-[14px] leading-relaxed outline-none placeholder:text-slate-400"
              placeholder={mode === 'forward' ? 'Add a note (optional)…' : 'Write your message…'}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            {dragging && (
              <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-400 bg-brand-50/80 text-sm font-semibold text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
                Drop files to attach
              </div>
            )}
          </div>

          {signature && account && (
            <div className="mx-4 mb-2 whitespace-pre-line border-l-2 border-brand-200 pl-3 text-xs text-slate-400 dark:border-brand-700">
              --{'\n'}{account.name}{'\n'}{account.designation}{'\n'}{account.domain}
            </div>
          )}
          {mode === 'forward' && <div className="mx-4 mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-ink-800">The original message and its attachments will be included below your note.</div>}

          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs dark:bg-ink-700">
                  <Paperclip size={11} /> <span className="max-w-[160px] truncate">{f.name}</span> <span className="text-slate-400">{bytes(f.size)}</span>
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-500"><X size={11} /></button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 border-t border-slate-100 px-3 py-2.5 dark:border-white/5">
            <button className="btn-primary px-4" onClick={send} disabled={sending}>
              {sending ? <Spinner size={14} /> : <Send size={14} />} Send
              <span className="hidden rounded bg-white/15 px-1.5 text-[10px] sm:inline">Ctrl ↵</span>
            </button>
            {mode !== 'forward' && (
              <>
                <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
                <button className="icon-btn" title="Attach files" onClick={() => fileRef.current?.click()}><Paperclip size={16} /></button>
              </>
            )}
            <button className={`icon-btn ${signature ? 'text-brand-600 dark:text-brand-300' : ''}`} title={signature ? 'Signature on' : 'Signature off'} onClick={() => setSignature(!signature)}><Signature size={16} /></button>
            <div className="relative">
              <button className="icon-btn" title="Templates" onClick={() => setShowTemplates(!showTemplates)}><FileText size={16} /></button>
              {showTemplates && (
                <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-2xl animate-fade-in dark:border-ink-600 dark:bg-ink-800">
                  <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Templates</div>
                  {templates.map((t) => (
                    <div key={t.name} className="group flex items-center rounded-lg hover:bg-slate-50 dark:hover:bg-white/5">
                      <button className="flex-1 truncate px-2 py-1.5 text-left text-sm" onClick={() => applyTemplate(t)}>{t.name}</button>
                      <button className="px-2 text-slate-300 opacity-0 hover:text-rose-500 group-hover:opacity-100" onClick={() => { const n = templates.filter((x) => x.name !== t.name); setTemplates(n); save(TEMPLATES_KEY, n); }}><Trash2 size={12} /></button>
                    </div>
                  ))}
                  {!templates.length && <div className="px-2 py-2 text-xs text-slate-400">No templates yet. Placeholders: {'{{sender_first}}'}, {'{{sender_name}}'}, {'{{designation}}'}, {'{{domain}}'}</div>}
                  <button className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-slate-100 px-2 py-2 text-left text-xs font-semibold text-brand-600 hover:bg-slate-50 dark:border-white/5 dark:text-brand-300 dark:hover:bg-white/5" onClick={saveTemplate} disabled={!body.trim()}>
                    <Save size={12} /> Save current message as template
                  </button>
                </div>
              )}
            </div>
            <span className="ml-auto hidden text-[11px] text-slate-400 sm:inline">{mode === 'new' && (to.length || body) ? 'Draft saved locally' : account ? `Sending as ${displayName({ name: account.name })}` : ''}</span>
            <button className="icon-btn" title="Discard" onClick={discard}><Trash2 size={16} /></button>
          </div>
        </>
      )}
    </div>
  );
}
