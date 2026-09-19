import { useEffect, useRef } from 'react';
import {
  Search, RefreshCw, Star, Archive, Trash2, MailOpen, Mail, Paperclip, Reply, Menu, X, CheckSquare, Square, MinusSquare, Globe,
} from 'lucide-react';
import { Avatar, EmptyState, Spinner } from './ui.jsx';
import { shortDate, displayName } from '../lib/format.js';

function Row({ m, active, checked, onOpen, onCheck, onStar, onArchive, onDelete, onToggleRead, showSlot, accountName }) {
  const outgoing = m.folder === 'sent' || m.folder === 'drafts';
  const person = outgoing ? m.to[0] || { address: '(no recipient)' } : m.from;
  return (
    <div
      role="button"
      tabIndex={-1}
      data-id={m.id}
      onClick={() => onOpen(m)}
      className={`group relative flex cursor-pointer gap-3 border-b border-slate-100 px-4 py-3 transition dark:border-white/5 ${
        active ? 'bg-brand-50/80 dark:bg-brand-900/30' : checked ? 'bg-brand-50/40 dark:bg-white/[.03]' : 'hover:bg-slate-50 dark:hover:bg-white/[.03]'
      }`}
    >
      {active && <span className="absolute inset-y-0 left-0 w-[3px] bg-brand-600 dark:bg-brand-400" />}
      <div className="relative">
        <Avatar person={person} size={38} />
        <button
          onClick={(e) => { e.stopPropagation(); onCheck(m.id); }}
          className={`absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-md bg-white text-brand-700 shadow ring-1 ring-slate-200 transition dark:bg-ink-800 dark:text-brand-300 dark:ring-ink-600 ${checked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          aria-label="Select"
        >
          {checked ? <CheckSquare size={13} /> : <Square size={13} />}
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {!m.seen && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600 dark:bg-brand-400" />}
          <span className={`truncate text-[13.5px] ${m.seen ? 'font-medium text-slate-600 dark:text-slate-300' : 'font-semibold text-slate-900 dark:text-white'}`}>
            {outgoing && <span className="font-normal text-slate-400">To: </span>}
            {displayName(person)}
          </span>
          {m.answered && <Reply size={12} className="shrink-0 text-slate-400" />}
          <span className="ml-auto shrink-0 text-[11.5px] text-slate-400 group-hover:hidden">{shortDate(m.date)}</span>
          <div className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn h-6 w-6" title={m.seen ? 'Mark unread' : 'Mark read'} onClick={() => onToggleRead(m)}>{m.seen ? <Mail size={13} /> : <MailOpen size={13} />}</button>
            {!['archive', 'drafts'].includes(m.folder) && <button className="icon-btn h-6 w-6" title="Archive" onClick={() => onArchive([m])}><Archive size={13} /></button>}
            <button className="icon-btn h-6 w-6" title="Delete" onClick={() => onDelete([m])}><Trash2 size={13} /></button>
          </div>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={`truncate text-[13px] ${m.seen ? 'text-slate-600 dark:text-slate-400' : 'font-semibold text-slate-800 dark:text-slate-100'}`}>{m.subject}</span>
        </div>
        <div className="mt-0.5 line-clamp-1 text-[12.5px] text-slate-400 dark:text-slate-500">{m.snippet || ' '}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          {showSlot && (
            <span className="slot-badge" title={accountName}>{m.slot}</span>
          )}
          {showSlot && <span className="truncate text-[11px] text-slate-400">{accountName}</span>}
          {m.attachments > 0 && <Paperclip size={12} className="text-slate-400" />}
          <button
            onClick={(e) => { e.stopPropagation(); onStar(m); }}
            className={`ml-auto transition ${m.flagged ? 'text-amber-400' : 'text-slate-300 opacity-0 hover:text-amber-400 group-hover:opacity-100 dark:text-slate-600'}`}
            title={m.flagged ? 'Unstar' : 'Star'}
          >
            <Star size={14} fill={m.flagged ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MessageList({
  title, subtitle, messages, total, loading, selectedId, onOpen, selection, setSelection, q, setQ, deep, setDeep,
  onRefresh, refreshing, onStar, onArchive, onDelete, onMarkRead, onLoadMore, hasMore, showSlot, accountsBySlot, onMenu,
}) {
  const searchRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !document.activeElement?.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`[data-id="${CSS.escape(selectedId || '')}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const selectedMsgs = messages.filter((m) => selection.has(m.id));
  const allChecked = messages.length > 0 && selectedMsgs.length === messages.length;
  const toggleAll = () => setSelection(allChecked ? new Set() : new Set(messages.map((m) => m.id)));
  const check = (id) => setSelection((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <section className="flex h-full min-w-0 flex-col border-r border-slate-200/80 bg-white dark:border-white/5 dark:bg-ink-900">
      <header className="border-b border-slate-100 px-4 pb-3 pt-4 dark:border-white/5">
        <div className="flex items-center gap-2">
          <button className="icon-btn lg:hidden" onClick={onMenu}><Menu size={18} /></button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-extrabold text-slate-900 dark:text-white">{title}</h1>
            <div className="truncate text-xs text-slate-500">{subtitle}</div>
          </div>
          <button className="icon-btn" onClick={onRefresh} title="Refresh">
            {refreshing ? <Spinner size={15} /> : <RefreshCw size={15} />}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              className="input pl-9 pr-8"
              placeholder={deep ? 'Search the mail server…' : 'Search mail  ( / )'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setQ(''), e.currentTarget.blur())}
            />
            {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700" onClick={() => setQ('')}><X size={14} /></button>}
          </div>
          <button
            onClick={() => setDeep(!deep)}
            title="Deep search: search full message bodies on the server, not just recent mail"
            className={`btn px-2.5 py-2 text-xs ${deep ? 'bg-brand-900 text-white dark:bg-brand-600' : 'btn-outline'}`}
          >
            <Globe size={14} /> Deep
          </button>
        </div>
      </header>

      {selectedMsgs.length > 0 ? (
        <div className="flex items-center gap-1 border-b border-slate-100 bg-brand-50/60 px-3 py-1.5 animate-fade-in dark:border-white/5 dark:bg-brand-900/20">
          <button className="icon-btn" onClick={toggleAll}>{allChecked ? <CheckSquare size={16} /> : <MinusSquare size={16} />}</button>
          <span className="text-xs font-semibold text-brand-800 dark:text-brand-200">{selectedMsgs.length} selected</span>
          <div className="ml-auto flex items-center gap-0.5">
            <button className="icon-btn" title="Mark read" onClick={() => onMarkRead(selectedMsgs, true)}><MailOpen size={15} /></button>
            <button className="icon-btn" title="Mark unread" onClick={() => onMarkRead(selectedMsgs, false)}><Mail size={15} /></button>
            <button className="icon-btn" title="Star" onClick={() => selectedMsgs.forEach((m) => !m.flagged && onStar(m))}><Star size={15} /></button>
            <button className="icon-btn" title="Archive" onClick={() => onArchive(selectedMsgs)}><Archive size={15} /></button>
            <button className="icon-btn" title="Delete" onClick={() => onDelete(selectedMsgs)}><Trash2 size={15} /></button>
            <button className="icon-btn" title="Clear selection" onClick={() => setSelection(new Set())}><X size={15} /></button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-1.5 text-[11px] text-slate-400 dark:border-white/5">
          <button className="hover:text-slate-700 dark:hover:text-slate-200" onClick={toggleAll} disabled={!messages.length}><Square size={13} /></button>
          <span>{loading ? 'Loading…' : `${total.toLocaleString()} conversation${total === 1 ? '' : 's'}`}</span>
          <span className="ml-auto hidden xl:inline">
            <span className="kbd">J</span> <span className="kbd">K</span> navigate · <span className="kbd">E</span> archive · <span className="kbd">R</span> reply
          </span>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {loading && !messages.length ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-white/5">
              <div className="skeleton h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-3 w-1/3" />
                <div className="skeleton h-3 w-2/3" />
                <div className="skeleton h-3 w-5/6" />
              </div>
            </div>
          ))
        ) : !messages.length ? (
          <EmptyState icon={q ? Search : MailOpen} title={q ? 'No matches' : 'All caught up'}>
            {q ? (deep ? 'Nothing on the server matches this search.' : 'Try Deep search to look through full messages on the server.') : 'Nothing here right now.'}
          </EmptyState>
        ) : (
          <>
            {messages.map((m) => (
              <Row
                key={m.id}
                m={m}
                active={m.id === selectedId}
                checked={selection.has(m.id)}
                onOpen={onOpen}
                onCheck={check}
                onStar={onStar}
                onArchive={onArchive}
                onDelete={onDelete}
                onToggleRead={(x) => onMarkRead([x], !x.seen)}
                showSlot={showSlot}
                accountName={accountsBySlot[m.slot]?.name}
              />
            ))}
            {hasMore && (
              <div className="p-4 text-center">
                <button className="btn-outline text-xs" onClick={onLoadMore}>Load more</button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
