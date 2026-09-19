import { useEffect, useMemo, useState } from 'react';
import { Search, Inbox, PenSquare, LayoutDashboard, MailOpen, Star, Send, Bot, Moon, RefreshCw, CornerDownLeft, Layers } from 'lucide-react';
import { Modal } from './ui.jsx';
import { matchAccounts } from './Compose.jsx';

export default function CommandPalette({ open, onClose, accounts, batches = [], actions }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);

  useEffect(() => { if (open) { setQ(''); setHi(0); } }, [open]);

  const items = useMemo(() => {
    const pages = [
      { id: 'p-dash', icon: LayoutDashboard, label: 'Dashboard', run: () => actions.page('dashboard') },
      { id: 'p-inbox', icon: Inbox, label: 'Unified inbox', run: () => actions.view('inbox', null) },
      { id: 'p-unread', icon: MailOpen, label: 'Unread', run: () => actions.view('unread', null) },
      { id: 'p-star', icon: Star, label: 'Starred', run: () => actions.view('starred', null) },
      { id: 'p-sent', icon: Send, label: 'Sent', run: () => actions.view('sent', null) },
      { id: 'p-compose', icon: PenSquare, label: 'Compose new email', run: () => actions.compose() },
      { id: 'p-ai', icon: Bot, label: 'Connect AI (MCP)', run: () => actions.page('connect') },
      { id: 'p-theme', icon: Moon, label: 'Toggle dark mode', run: () => actions.theme() },
      { id: 'p-sync', icon: RefreshCw, label: 'Sync all mailboxes now', run: () => actions.sync() },
      ...(batches.length > 1
        ? [
            { id: 'b-all', icon: Layers, label: 'Show all batches', run: () => actions.batch('all') },
            ...batches.map((b) => ({ id: `b-${b}`, icon: Layers, label: `Show Batch ${b} only`, run: () => actions.batch(b) })),
          ]
        : []),
    ];
    const s = q.trim().toLowerCase();
    const matchedPages = s ? pages.filter((p) => p.label.toLowerCase().includes(s)) : pages.slice(0, 6);
    const accs = (s ? matchAccounts(accounts, s) : accounts).slice(0, s ? 8 : 6);
    const out = [];
    for (const a of accs) {
      out.push({ id: `o-${a.slot}`, slot: a, label: `Open ${a.name}'s inbox`, sub: a.email, run: () => actions.view('inbox', a.slot) });
      if (s) out.push({ id: `c-${a.slot}`, slot: a, compose: true, label: `Compose from ${a.name}`, sub: a.email, run: () => actions.compose(a.slot) });
    }
    return [...(s ? out : []), ...matchedPages, ...(s ? [] : out)];
  }, [q, accounts, batches, actions]);

  useEffect(() => setHi(0), [q]);

  const run = (item) => { onClose(); item.run(); };

  return (
    <Modal open={open} onClose={onClose} className="max-w-xl overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 dark:border-white/5">
        <Search size={18} className="text-slate-400" />
        <input
          autoFocus
          className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-slate-400"
          placeholder='Type a slot like "1A", a name, or a command…'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, items.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === 'Enter' && items[hi]) run(items[hi]);
            if (e.key === 'Escape') onClose();
          }}
        />
        <span className="kbd">Esc</span>
      </div>
      <div className="max-h-[50vh] overflow-y-auto p-2">
        {items.map((it, i) => {
          const Icon = it.icon || (it.compose ? PenSquare : Inbox);
          return (
            <button
              key={it.id}
              onMouseEnter={() => setHi(i)}
              onClick={() => run(it)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${i === hi ? 'bg-brand-50 text-brand-900 dark:bg-white/5 dark:text-white' : 'text-slate-700 dark:text-slate-300'}`}
            >
              {it.slot ? <span className="slot-badge">{it.slot.slot}</span> : <Icon size={16} className="text-slate-400" />}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 truncate">{it.slot && <Icon size={13} className="text-slate-400" />}{it.label}</span>
                {it.sub && <span className="block truncate text-xs text-slate-400">{it.sub}</span>}
              </span>
              {i === hi && <CornerDownLeft size={14} className="text-slate-400" />}
            </button>
          );
        })}
        {!items.length && <div className="p-6 text-center text-sm text-slate-400">No results</div>}
      </div>
      <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-white/5">
        <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
        <span><span className="kbd">↵</span> select</span>
        <span className="ml-auto">Tip: “ia” also finds slot 1A</span>
      </div>
    </Modal>
  );
}
