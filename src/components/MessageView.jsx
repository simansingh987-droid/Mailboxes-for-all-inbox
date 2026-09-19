import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Reply, ReplyAll, Forward, Star, Archive, Trash2, Mail, ArrowLeft, Paperclip, Download, ImageOff, Image as ImageIcon,
  ChevronDown, Send, Inbox as InboxIcon, Copy,
} from 'lucide-react';
import { api, attachmentUrl } from '../lib/api.js';
import { Avatar, EmptyState, Spinner, useToast } from './ui.jsx';
import { longDate, bytes, displayName } from '../lib/format.js';

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const linkify = (s) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');

function EmailFrame({ message, showImages }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(60);

  const srcDoc = useMemo(() => {
    let body = message.html
      ? message.html
      : `<div style="white-space:pre-wrap">${linkify(escapeHtml(message.text || ''))}</div>`;
    for (const img of message.inlineImages || []) body = body.split(`cid:${img.cid}`).join(img.dataUrl);
    const remote = showImages ? ' https: http:' : '';
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:${remote}; style-src 'unsafe-inline'${remote}; font-src data:${remote}; media-src data:${remote};">
<base target="_blank">
<style>
html,body{margin:0;padding:0;background:#fff;height:auto}
body{font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;padding:2px 2px 8px;overflow-wrap:anywhere}
img{max-width:100%;height:auto} a{color:#2d4a73} table{max-width:100%}
blockquote{margin:8px 0 8px 4px;padding-left:12px;border-left:3px solid #dce5f1;color:#475569}
pre{white-space:pre-wrap}
</style></head><body>${body}</body></html>`;
  }, [message, showImages]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let ro;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc?.body) return;
      setHeight(Math.max(40, doc.body.scrollHeight + 12));
    };
    const onLoad = () => {
      measure();
      ro = new ResizeObserver(measure);
      if (frame.contentDocument?.body) ro.observe(frame.contentDocument.body);
      frame.contentDocument?.querySelectorAll('img').forEach((i) => i.addEventListener('load', measure));
    };
    frame.addEventListener('load', onLoad);
    return () => { frame.removeEventListener('load', onLoad); ro?.disconnect(); };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title="Email content"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      className="w-full rounded-lg bg-white"
      style={{ height }}
    />
  );
}

export default function MessageView({ id, summary, account, onBack, onReply, onForward, onStar, onArchive, onDelete, onMarkRead, onSent }) {
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [quick, setQuick] = useState('');
  const [sending, setSending] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!id) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    setMessage(null);
    setShowImages(false);
    setQuick('');
    api(`/messages/${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then(setMessage)
      .catch((e) => e.name !== 'AbortError' && setError(e.message))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [id]);

  if (!id) {
    return (
      <div className="relative hidden h-full flex-1 items-center justify-center overflow-hidden bg-silver-100 dark:bg-ink-950 md:flex">
        <img src="/logo.webp" alt="" className="pointer-events-none absolute w-[28rem] opacity-[.04] dark:opacity-[.06]" />
        <EmptyState title="Select a conversation">
          Choose an email to read it here. Press <span className="kbd">C</span> to compose or <span className="kbd">Ctrl</span> <span className="kbd">K</span> to jump to a mailbox.
        </EmptyState>
      </div>
    );
  }

  const m = message ? { ...summary, ...message, flagged: summary?.flagged ?? message.flagged } : null;
  const hasRemoteImages = m?.html && /<img[^>]+src=["']?https?:/i.test(m.html);

  const sendQuick = async () => {
    if (!quick.trim()) return;
    setSending(true);
    try {
      const r = await api(`/messages/${encodeURIComponent(id)}/reply`, { method: 'POST', body: { text: quick } });
      toast(`Reply sent from ${account?.slot} to ${r.to.join(', ')}`, { title: 'Sent' });
      setQuick('');
      onSent?.();
    } catch (e) {
      toast(e.message, { type: 'error', title: 'Could not send' });
    } finally {
      setSending(false);
    }
  };

  return (
    <article className="flex h-full min-w-0 flex-1 flex-col bg-silver-100 dark:bg-ink-950">
      <div className="flex items-center gap-1 border-b border-slate-200/80 bg-white/80 px-3 py-2 backdrop-blur dark:border-white/5 dark:bg-ink-900/80">
        <button className="icon-btn md:hidden" onClick={onBack}><ArrowLeft size={17} /></button>
        <button className="icon-btn" title="Reply (R)" onClick={() => onReply(m, false)} disabled={!m}><Reply size={16} /></button>
        <button className="icon-btn" title="Reply all (A)" onClick={() => onReply(m, true)} disabled={!m}><ReplyAll size={16} /></button>
        <button className="icon-btn" title="Forward (F)" onClick={() => onForward(m)} disabled={!m}><Forward size={16} /></button>
        <span className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
        <button className="icon-btn" title="Archive (E)" onClick={() => onArchive([summary || m])}><Archive size={16} /></button>
        <button className="icon-btn" title="Delete (#)" onClick={() => onDelete([summary || m])}><Trash2 size={16} /></button>
        <button className="icon-btn" title="Mark unread (U)" onClick={() => onMarkRead([summary || m], false)}><Mail size={16} /></button>
        <button className={`icon-btn ${m?.flagged ? 'text-amber-400' : ''}`} title="Star (S)" onClick={() => onStar(summary || m)}>
          <Star size={16} fill={m?.flagged ? 'currentColor' : 'none'} />
        </button>
        {account && (
          <div className="ml-auto hidden items-center gap-2 rounded-full bg-brand-50 py-1 pl-1 pr-3 text-xs ring-1 ring-brand-100 dark:bg-brand-900/40 dark:ring-brand-800 sm:flex">
            <span className="rounded-full bg-brand-900 px-2 py-0.5 text-[10px] font-bold text-white dark:bg-brand-600">{account.slot}</span>
            <span className="text-brand-800 dark:text-brand-200">{account.email}</span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <div className="mx-auto max-w-4xl space-y-4 p-6">
            <div className="skeleton h-7 w-2/3" />
            <div className="flex gap-3"><div className="skeleton h-11 w-11 rounded-full" /><div className="flex-1 space-y-2"><div className="skeleton h-3 w-1/3" /><div className="skeleton h-3 w-1/4" /></div></div>
            <div className="skeleton h-64 w-full rounded-xl" />
          </div>
        )}
        {error && <EmptyState icon={InboxIcon} title="Could not open this email">{error}</EmptyState>}
        {m && (
          <div className="mx-auto max-w-4xl p-4 sm:p-6 animate-fade-in">
            <h2 className="font-display text-xl font-extrabold leading-snug text-slate-900 dark:text-white sm:text-2xl">{m.subject}</h2>
            <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card dark:border-white/5 dark:bg-ink-900 sm:p-5">
              <div className="flex items-start gap-3">
                <Avatar person={m.from} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold text-slate-900 dark:text-white">{displayName(m.from)}</span>
                    <span className="truncate text-sm text-slate-500">&lt;{m.from.address}&gt;</span>
                    <button className="text-slate-300 hover:text-slate-600" title="Copy address" onClick={() => { navigator.clipboard?.writeText(m.from.address); toast('Address copied', { type: 'info', duration: 1500 }); }}><Copy size={12} /></button>
                  </div>
                  <button className="mt-0.5 flex items-center gap-1 text-left text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200" onClick={() => setShowDetails(!showDetails)}>
                    to {m.to.slice(0, 3).map((t) => (t.address === account?.email ? 'me' : displayName(t))).join(', ') || 'undisclosed recipients'}
                    {m.to.length > 3 && ` and ${m.to.length - 3} more`}
                    {m.cc.length > 0 && `, cc ${m.cc.length}`}
                    <ChevronDown size={12} className={showDetails ? 'rotate-180' : ''} />
                  </button>
                  {showDetails && (
                    <div className="mt-2 grid grid-cols-[60px_1fr] gap-x-2 gap-y-1 rounded-lg bg-slate-50 p-3 text-xs dark:bg-ink-800">
                      <span className="text-slate-400">From</span><span className="break-all">{m.from.name} &lt;{m.from.address}&gt;</span>
                      <span className="text-slate-400">To</span><span className="break-all">{m.to.map((t) => t.address).join(', ')}</span>
                      {m.cc.length > 0 && (<><span className="text-slate-400">Cc</span><span className="break-all">{m.cc.map((t) => t.address).join(', ')}</span></>)}
                      {m.replyTo?.length > 0 && (<><span className="text-slate-400">Reply-To</span><span className="break-all">{m.replyTo.map((t) => t.address).join(', ')}</span></>)}
                      <span className="text-slate-400">Date</span><span>{longDate(m.date)}</span>
                      <span className="text-slate-400">Mailbox</span><span>{account?.slot} · {account?.name} · {account?.email}</span>
                    </div>
                  )}
                </div>
                <div className="shrink-0 text-right text-xs text-slate-400">{longDate(m.date)}</div>
              </div>

              {hasRemoteImages && (
                <div className="mt-4 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-ink-800">
                  {showImages ? <ImageIcon size={14} /> : <ImageOff size={14} />}
                  {showImages ? 'Remote images are shown.' : 'Remote images are blocked to protect your privacy.'}
                  <button className="ml-auto font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => setShowImages(!showImages)}>
                    {showImages ? 'Hide images' : 'Show images'}
                  </button>
                </div>
              )}

              <div className="mt-4 overflow-hidden rounded-lg">
                <EmailFrame message={m} showImages={showImages} />
              </div>

              {m.attachments.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Paperclip size={13} /> {m.attachments.length} attachment{m.attachments.length > 1 && 's'}</div>
                  <div className="flex flex-wrap gap-2">
                    {m.attachments.map((a) => (
                      <a key={a.index} href={attachmentUrl(m.id, a.index)} className="group flex max-w-[260px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 transition hover:border-brand-300 hover:bg-brand-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:border-brand-600">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-900 text-[9px] font-bold uppercase text-white">{(a.filename.split('.').pop() || 'file').slice(0, 4)}</div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">{a.filename}</div>
                          <div className="text-[11px] text-slate-400">{bytes(a.size)}</div>
                        </div>
                        <Download size={14} className="ml-1 shrink-0 text-slate-400 group-hover:text-brand-600" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {m.folder !== 'drafts' && (
              <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-card focus-within:ring-2 focus-within:ring-brand-400/30 dark:border-white/5 dark:bg-ink-900">
                <div className="mb-2 flex items-center gap-2 px-1 text-xs text-slate-500">
                  <Reply size={13} /> Quick reply to <b className="font-semibold text-slate-700 dark:text-slate-300">{displayName(m.folder === 'sent' ? m.to[0] : (m.replyTo?.[0] || m.from))}</b>
                  <span className="ml-auto">from <span className="slot-badge">{account?.slot}</span></span>
                </div>
                <textarea
                  className="min-h-[84px] w-full resize-y bg-transparent px-1 text-sm outline-none placeholder:text-slate-400"
                  placeholder="Write a reply…  (Ctrl + Enter to send)"
                  value={quick}
                  onChange={(e) => setQuick(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && sendQuick()}
                />
                <div className="flex items-center justify-end gap-2">
                  <button className="btn-ghost text-xs" onClick={() => onReply(m, false, quick)}>Open full editor</button>
                  <button className="btn-primary text-xs" disabled={!quick.trim() || sending} onClick={sendQuick}>
                    {sending ? <Spinner size={14} /> : <Send size={14} />} Send
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
