import { useMemo, useRef, useState } from 'react';
import {
  Inbox, MailOpen, Star, Send, Paperclip, LayoutDashboard, PenSquare, Search, Moon, Sun, LogOut,
  Bot, FileText, Archive, ShieldAlert, Trash2, RefreshCw, X, Command, CheckSquare, Square, ListChecks, Bookmark, BookmarkPlus,
} from 'lucide-react';
import { parseSlotSelection, describeSlots } from '../../shared/slots.js';
import { Logo, Spinner } from './ui.jsx';
import { relative } from '../lib/format.js';

const GROUPS_KEY = 'acm-groups';
const loadGroups = () => { try { return JSON.parse(localStorage.getItem(GROUPS_KEY)) || []; } catch { return []; } };

const VIEWS = [
  { key: 'inbox', label: 'Unified Inbox', icon: Inbox },
  { key: 'unread', label: 'Unread', icon: MailOpen },
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'sent', label: 'Sent', icon: Send },
  { key: 'attachments', label: 'Attachments', icon: Paperclip },
];

const FOLDERS = [
  { key: 'drafts', label: 'Drafts', icon: FileText },
  { key: 'archive', label: 'Archive', icon: Archive },
  { key: 'junk', label: 'Spam', icon: ShieldAlert },
  { key: 'trash', label: 'Trash', icon: Trash2 },
];

function NavItem({ active, icon: Icon, label, count, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
        active
          ? 'bg-white text-brand-900 shadow-card ring-1 ring-slate-200 dark:bg-white/10 dark:text-white dark:ring-white/10'
          : 'text-slate-600 hover:bg-slate-900/5 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white'
      }`}
    >
      <Icon size={17} className={active ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200'} />
      <span className="flex-1 text-left">{label}</span>
      {count > 0 && (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${accent ? 'bg-brand-800 text-white dark:bg-brand-500' : 'bg-slate-200/80 text-slate-600 dark:bg-white/10 dark:text-slate-300'}`}>
          {count > 999 ? '999+' : count}
        </span>
      )}
    </button>
  );
}

export default function Sidebar({
  accounts, batches = [], batch = 'all', setBatch, picked = [], setPicked, nav, setNav, onCompose, theme, toggleTheme, onLogout, authRequired, sync, onSync, onPalette, open, onClose,
}) {
  const [filter, setFilter] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [rangeText, setRangeText] = useState('');
  const [rangeError, setRangeError] = useState('');
  const [groups, setGroups] = useState(loadGroups);
  const lastClicked = useRef(null);
  const selectMode = selecting || picked.length > 0;
  const pickedSet = new Set(picked);

  const saveGroups = (g) => { setGroups(g); try { localStorage.setItem(GROUPS_KEY, JSON.stringify(g)); } catch {} };
  const applyPicked = (slots) => {
    setPicked(slots);
    setNav((n) => ({ ...n, page: n.page === 'dashboard' ? 'dashboard' : 'mail', slot: null, view: ['drafts', 'archive', 'junk', 'trash'].includes(n.view) ? 'inbox' : n.view }));
  };
  const togglePick = (slot, shift) => {
    let next;
    if (shift && lastClicked.current) {
      const order = list.map((a) => a.slot);
      const [i, j] = [order.indexOf(lastClicked.current), order.indexOf(slot)].sort((a, b) => a - b);
      next = [...new Set([...picked, ...(i >= 0 ? order.slice(i, j + 1) : [slot])])];
    } else {
      next = pickedSet.has(slot) ? picked.filter((s) => s !== slot) : [...picked, slot];
    }
    lastClicked.current = slot;
    applyPicked(next);
  };
  const submitRange = (e) => {
    e.preventDefault();
    if (!rangeText.trim()) return;
    const { slots, unknown } = parseSlotSelection(rangeText, accounts);
    if (!slots.length) { setRangeError(`Nothing matched "${rangeText}"`); return; }
    setRangeError(unknown.length ? `Ignored: ${unknown.join(', ')}` : '');
    applyPicked([...new Set([...picked, ...slots])]);
    setRangeText('');
  };
  const saveGroup = () => {
    const name = prompt('Name this group of mailboxes', describeSlots(picked));
    if (!name) return;
    saveGroups([...groups.filter((g) => g.name !== name), { name, slots: picked }]);
  };
  const inBatch = useMemo(() => (batch === 'all' ? accounts : accounts.filter((a) => String(a.batch) === batch)), [accounts, batch]);
  const totalUnread = (picked.length ? accounts.filter((a) => picked.includes(a.slot)) : inBatch).reduce((n, a) => n + (a.unread || 0), 0);
  const selected = accounts.find((a) => a.slot === nav.slot);
  const batchTabs = [
    { key: 'all', label: 'All', count: accounts.length, unread: accounts.reduce((n, a) => n + (a.unread || 0), 0) },
    ...batches.map((b) => {
      const list = accounts.filter((a) => a.batch === b);
      return { key: String(b), label: `Batch ${b}`, count: list.length, unread: list.reduce((n, a) => n + (a.unread || 0), 0) };
    }),
  ];

  const list = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return inBatch;
    return inBatch.filter((a) => `${a.slot} ${a.name} ${a.email} ${a.designation}`.toLowerCase().includes(q));
  }, [inBatch, filter]);

  const go = (patch) => {
    setNav((n) => ({ ...n, page: 'mail', ...patch }));
    onClose?.();
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink-950/40 backdrop-blur-sm lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[272px] flex-col border-r border-slate-200/80 bg-silver-100/95 backdrop-blur transition-transform dark:border-white/5 dark:bg-ink-950/95 lg:static lg:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-3 pt-4">
          <Logo size={38} subtitle={`${accounts.length} mailboxes · ${batches.length || 1} batch${batches.length > 1 ? 'es' : ''}`} />
          <button className="icon-btn lg:hidden" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="px-3">
          <button className="btn-primary w-full py-2.5" onClick={() => { onCompose(); onClose?.(); }}>
            <PenSquare size={16} /> Compose
            <span className="ml-auto rounded bg-white/15 px-1.5 text-[10px] font-semibold">C</span>
          </button>
          <button onClick={onPalette} className="mt-2 flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-400 transition hover:border-brand-300 dark:border-ink-600 dark:bg-ink-900 dark:hover:border-brand-600">
            <Search size={15} /> <span className="flex-1 text-left">Jump to…</span>
            <span className="kbd"><Command size={10} /></span><span className="kbd">K</span>
          </button>
        </div>

        {/* Nav, filters and the mailbox list scroll together so the list never collapses on short screens. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
        <nav className="mt-4 space-y-0.5 px-3">
          <NavItem icon={LayoutDashboard} label="Dashboard" active={nav.page === 'dashboard'} onClick={() => { setNav((n) => ({ ...n, page: 'dashboard' })); onClose?.(); }} />
          {VIEWS.map((v) => (
            <NavItem
              key={v.key}
              icon={v.icon}
              label={v.key === 'inbox' && selected ? 'Inbox' : v.label}
              active={nav.page === 'mail' && nav.view === v.key}
              count={v.key === 'inbox' ? (selected ? selected.unread : totalUnread) : 0}
              accent={v.key === 'inbox'}
              onClick={() => go({ view: v.key })}
            />
          ))}
          {selected &&
            FOLDERS.map((f) => (
              <NavItem key={f.key} icon={f.icon} label={f.label} active={nav.page === 'mail' && nav.view === f.key} onClick={() => go({ view: f.key })} />
            ))}
          <NavItem icon={Bot} label="Connect AI (MCP)" active={nav.page === 'connect'} onClick={() => { setNav((n) => ({ ...n, page: 'connect' })); onClose?.(); }} />
        </nav>

        <div className="mt-5 flex items-center justify-between px-5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Mailboxes{batch !== 'all' && ` · Batch ${batch}`}</span>
          <button
            className={`ml-auto mr-2 flex items-center gap-1 text-[11px] font-semibold ${selectMode ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            onClick={() => { if (selectMode) { setSelecting(false); applyPicked([]); } else setSelecting(true); }}
            title="Select several mailboxes to view together"
          >
            <ListChecks size={13} /> {selectMode ? 'Done' : 'Select'}
          </button>
          {nav.slot && (
            <button className="text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => go({ slot: null, view: ['drafts', 'archive', 'junk', 'trash'].includes(nav.view) ? 'inbox' : nav.view })}>
              Show all
            </button>
          )}
        </div>
        {batchTabs.length > 2 && (
          <div className="px-3 pt-2">
            <div className="flex rounded-lg bg-slate-900/5 p-0.5 dark:bg-white/5" role="tablist" aria-label="Mailbox batch">
              {batchTabs.map((t) => (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={batch === t.key}
                  onClick={() => setBatch(t.key)}
                  title={`${t.count} mailboxes · ${t.unread} unread`}
                  className={`flex-1 rounded-md px-1.5 py-1 text-[11.5px] font-semibold transition ${
                    batch === t.key
                      ? 'bg-white text-brand-900 shadow-card dark:bg-brand-700 dark:text-white'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {t.label}
                  <span className={`ml-1 font-medium ${batch === t.key ? 'text-brand-500 dark:text-brand-200' : 'text-slate-400'}`}>{t.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {groups.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pt-2">
            {groups.map((g) => {
              const on = g.slots.length === picked.length && g.slots.every((s) => pickedSet.has(s));
              return (
                <span key={g.name} className={`group inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-[11px] font-semibold ring-1 transition ${on ? 'bg-brand-900 text-white ring-brand-900 dark:bg-brand-600 dark:ring-brand-600' : 'bg-white text-slate-600 ring-slate-200 hover:ring-brand-300 dark:bg-ink-900 dark:text-slate-300 dark:ring-ink-600'}`}>
                  <button className="flex items-center gap-1" onClick={() => applyPicked(on ? [] : g.slots)} title={describeSlots(g.slots)}>
                    <Bookmark size={10} /> {g.name} <span className="opacity-60">{g.slots.length}</span>
                  </button>
                  <button className="rounded-full p-0.5 opacity-0 hover:bg-black/10 group-hover:opacity-100" onClick={() => saveGroups(groups.filter((x) => x.name !== g.name))} title="Delete group"><X size={10} /></button>
                </span>
              );
            })}
          </div>
        )}
        {selectMode && (
          <form onSubmit={submitRange} className="px-3 pt-2">
            <div className="flex gap-1">
              <input
                className="input py-1.5 text-[13px]"
                placeholder="Type slots: 1A-5A, 3B, 7B"
                value={rangeText}
                onChange={(e) => { setRangeText(e.target.value); setRangeError(''); }}
              />
              <button className="btn-primary px-2.5 py-1.5 text-xs" disabled={!rangeText.trim()}>Add</button>
            </div>
            {rangeError && <div className="mt-1 text-[11px] text-rose-500">{rangeError}</div>}
          </form>
        )}
        {picked.length > 0 && (
          <div className="mx-3 mt-2 rounded-lg bg-brand-50 px-2.5 py-2 text-[11.5px] ring-1 ring-brand-100 dark:bg-brand-900/40 dark:ring-brand-800">
            <div className="flex items-center gap-1 font-semibold text-brand-900 dark:text-brand-100">
              <CheckSquare size={13} /> {picked.length} selected
              <button className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-brand-100 dark:hover:bg-white/10" onClick={saveGroup} title="Save this selection as a group"><BookmarkPlus size={12} /> Save</button>
              <button className="rounded px-1.5 py-0.5 hover:bg-brand-100 dark:hover:bg-white/10" onClick={() => applyPicked([])}>Clear</button>
            </div>
            <div className="mt-0.5 truncate text-brand-700 dark:text-brand-300" title={describeSlots(picked)}>{describeSlots(picked)}</div>
            <button className="mt-1 text-[11px] font-semibold text-brand-600 hover:underline dark:text-brand-300" onClick={() => applyPicked([...new Set([...picked, ...list.map((a) => a.slot)])])}>
              + Select all {list.length} shown
            </button>
          </div>
        )}
        <div className="px-3 pt-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input py-1.5 pl-8 text-[13px]" placeholder="Slot, name or email" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
        <div className="mt-2 space-y-0.5 px-3 pb-3">
          {list.map((a) => {
            const active = !selectMode && nav.slot === a.slot;
            const checked = pickedSet.has(a.slot);
            return (
              <button
                key={a.slot}
                onClick={(e) => (selectMode ? togglePick(a.slot, e.shiftKey) : go({ slot: active ? null : a.slot, view: active ? nav.view : 'inbox' }))}
                title={`${a.name} · ${a.designation}\n${a.email}${a.error ? `\n⚠ ${a.error}` : ''}`}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                  active ? 'bg-brand-900 text-white shadow-glow dark:bg-brand-700' : 'hover:bg-slate-900/5 dark:hover:bg-white/5'
                }`}
              >
                {selectMode && (
                  <span className={checked ? 'text-brand-600 dark:text-brand-300' : 'text-slate-300 dark:text-slate-600'}>
                    {checked ? <CheckSquare size={16} /> : <Square size={16} />}
                  </span>
                )}
                <span className={active ? 'inline-flex min-w-[2.25rem] justify-center rounded-md bg-white/15 px-1.5 py-0.5 text-[11px] font-semibold' : 'slot-badge'}>{a.slot}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-[13px] font-medium ${active ? '' : 'text-slate-800 dark:text-slate-200'}`}>{a.name}</span>
                  <span className={`block truncate text-[11px] ${active ? 'text-brand-200' : 'text-slate-400'}`}>{a.email}</span>
                </span>
                {a.status === 'error' ? (
                  <span className="h-2 w-2 rounded-full bg-rose-500" title={a.error} />
                ) : a.unread > 0 ? (
                  <span className={`text-[11px] font-semibold ${active ? 'text-white' : 'text-brand-700 dark:text-brand-300'}`}>{a.unread}</span>
                ) : null}
              </button>
            );
          })}
          {!list.length && <div className="px-2 py-6 text-center text-xs text-slate-400">No mailbox matches “{filter}”</div>}
        </div>
        </div>

        <div className="flex items-center gap-1 border-t border-slate-200/80 px-3 py-2.5 dark:border-white/5">
          <button className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-slate-500 hover:bg-slate-900/5 dark:hover:bg-white/5" onClick={onSync} title="Sync all mailboxes now">
            {sync.running ? <Spinner size={13} className="text-brand-500" /> : <RefreshCw size={13} />}
            <span className="truncate">{sync.running ? 'Syncing mailboxes…' : `Synced ${relative(sync.lastFullSync)}`}</span>
          </button>
          <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
          {authRequired && <button className="icon-btn" onClick={onLogout} title="Sign out"><LogOut size={16} /></button>}
        </div>
      </aside>
    </>
  );
}
