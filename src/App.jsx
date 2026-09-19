import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, auth, eventsUrl, setUnauthorizedHandler } from './lib/api.js';
import { displayName } from './lib/format.js';
import { describeSlots } from '../shared/slots.js';
import { useToast, Spinner } from './components/ui.jsx';
import Login from './components/Login.jsx';
import Sidebar from './components/Sidebar.jsx';
import MessageList from './components/MessageList.jsx';
import MessageView from './components/MessageView.jsx';
import Compose from './components/Compose.jsx';
import Dashboard from './components/Dashboard.jsx';
import ConnectAI from './components/ConnectAI.jsx';
import CommandPalette from './components/CommandPalette.jsx';

const CACHED_VIEWS = ['inbox', 'unread', 'starred', 'sent', 'attachments'];
const VIEW_TITLES = { inbox: 'Inbox', unread: 'Unread', starred: 'Starred', sent: 'Sent', attachments: 'With attachments', drafts: 'Drafts', archive: 'Archive', junk: 'Spam', trash: 'Trash' };
const PAGE = 50;

function useTheme() {
  const [theme, setTheme] = useState(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try { localStorage.setItem('acm-theme', next); } catch {}
      return next;
    });
  }, []);
  return [theme, toggle];
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export default function App() {
  const [session, setSession] = useState({ state: 'loading', authRequired: false });

  const check = useCallback(() => {
    fetch('/api/session', { headers: auth.get() ? { Authorization: `Bearer ${auth.get()}` } : {} })
      .then((r) => r.json())
      .then((s) => setSession({ state: s.authenticated ? 'ready' : 'login', authRequired: s.authRequired }))
      .catch(() => setSession({ state: 'offline', authRequired: false }));
  }, []);

  useEffect(() => {
    check();
    setUnauthorizedHandler(() => { auth.set(''); setSession((s) => ({ ...s, state: 'login' })); });
  }, [check]);

  if (session.state === 'loading') {
    return <div className="flex h-full items-center justify-center"><Spinner size={24} className="text-brand-500" /></div>;
  }
  if (session.state === 'offline') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <img src="/logo.webp" alt="" className="w-20 opacity-80" />
        <div className="font-display text-lg font-bold">Can’t reach the AskCruz Mailbox server</div>
        <div className="text-sm text-slate-500">Start it with <code className="rounded bg-slate-200 px-1.5 dark:bg-ink-800">npm run dev</code> and retry.</div>
        <button className="btn-primary" onClick={check}>Retry</button>
      </div>
    );
  }
  if (session.state === 'login') return <Login onSuccess={check} />;
  return <Mailbox authRequired={session.authRequired} onLogout={() => { auth.set(''); check(); }} />;
}

function Mailbox({ authRequired, onLogout }) {
  const toast = useToast();
  const [theme, toggleTheme] = useTheme();
  const [accounts, setAccounts] = useState([]);
  const [sync, setSync] = useState({ running: false, lastFullSync: null });
  const [nav, setNav] = useState({ page: 'mail', view: 'inbox', slot: null });
  const [batches, setBatches] = useState([]);
  const [batch, setBatchState] = useState(() => { try { return localStorage.getItem('acm-batch') || 'all'; } catch { return 'all'; } });
  const setBatch = useCallback((b) => {
    setBatchState(String(b));
    try { localStorage.setItem('acm-batch', String(b)); } catch {}
  }, []);
  // A custom set of mailboxes ("picked") narrows every unified view to just those slots.
  const [picked, setPickedState] = useState(() => { try { return JSON.parse(localStorage.getItem('acm-picked')) || []; } catch { return []; } });
  const setPicked = useCallback((next) => {
    setPickedState((prev) => {
      const v = typeof next === 'function' ? next(prev) : next;
      try { localStorage.setItem('acm-picked', JSON.stringify(v)); } catch {}
      return v;
    });
  }, []);
  const [q, setQ] = useState('');
  const [deep, setDeep] = useState(false);
  const [list, setList] = useState({ messages: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selection, setSelection] = useState(new Set());
  const [compose, setCompose] = useState(null);
  const [palette, setPalette] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const debouncedQ = useDebounced(q, deep ? 600 : 200);
  const reqId = useRef(0);

  const accountsBySlot = useMemo(() => Object.fromEntries(accounts.map((a) => [a.slot, a])), [accounts]);
  const visibleAccounts = useMemo(() => (batch === 'all' ? accounts : accounts.filter((a) => String(a.batch) === batch)), [accounts, batch]);
  const selectedAccount = nav.slot ? accountsBySlot[nav.slot] : null;
  const totalUnread = (picked.length ? picked.map((s) => accountsBySlot[s]).filter(Boolean) : visibleAccounts).reduce((n, a) => n + (a.unread || 0), 0);
  const validPicked = useMemo(() => picked.filter((s) => accountsBySlot[s] || !accounts.length), [picked, accountsBySlot, accounts.length]);
  const batchQuery = validPicked.length ? `&slots=${validPicked.join(',')}` : batch === 'all' ? '' : `&batch=${batch}`;
  const scopeAccounts = validPicked.length ? validPicked.map((s) => accountsBySlot[s]).filter(Boolean) : visibleAccounts;
  const batchLabel = batch === 'all' ? '' : `Batch ${batch} · `;

  // Leaving a batch clears a selected mailbox that is not part of it.
  useEffect(() => {
    if (batch !== 'all' && selectedAccount && String(selectedAccount.batch) !== batch) setNav((n) => ({ ...n, slot: null }));
    if (batch !== 'all' && batches.length && !batches.map(String).includes(batch)) setBatch('all');
  }, [batch, selectedAccount, batches, setBatch]);

  // ---------- data ----------

  const loadAccounts = useCallback(() => api('/accounts').then((r) => { setAccounts(r.accounts); setBatches(r.batches || []); setSync(r.sync); }).catch(() => {}), []);

  const loadMessages = useCallback(async ({ append = false, silent = false } = {}) => {
    if (nav.page !== 'mail') return;
    const id = ++reqId.current;
    if (!silent) setLoading(true);
    try {
      let r;
      const slots = nav.slot || '';
      if (CACHED_VIEWS.includes(nav.view)) {
        if (deep && debouncedQ.trim()) {
          r = await api(`/search?q=${encodeURIComponent(debouncedQ)}&folder=${nav.view === 'sent' ? 'sent' : 'inbox'}${slots ? `&slots=${slots}` : batchQuery}`);
        } else {
          const offset = append ? list.messages.length : 0;
          r = await api(`/messages?view=${nav.view}&limit=${PAGE}&offset=${offset}${slots ? `&slots=${slots}` : batchQuery}${debouncedQ ? `&q=${encodeURIComponent(debouncedQ)}` : ''}`);
          if (append) r = { ...r, messages: [...list.messages, ...r.messages] };
        }
      } else if (nav.slot) {
        r = await api(`/folders/${nav.slot}/${nav.view}?limit=100`);
        if (debouncedQ) {
          const s = debouncedQ.toLowerCase();
          r.messages = r.messages.filter((m) => `${m.subject} ${m.from.address} ${m.from.name} ${m.snippet}`.toLowerCase().includes(s));
        }
      } else {
        r = { messages: [], total: 0 };
      }
      if (id === reqId.current) setList({ messages: r.messages, total: r.total ?? r.messages.length });
    } catch (e) {
      if (id === reqId.current) {
        setList({ messages: [], total: 0 });
        toast(e.message, { type: 'error', title: 'Could not load mail' });
      }
    } finally {
      if (id === reqId.current) { setLoading(false); setRefreshing(false); }
    }
  }, [nav, deep, debouncedQ, list.messages, toast, batchQuery]);

  useEffect(() => { loadAccounts(); const t = setInterval(loadAccounts, 30000); return () => clearInterval(t); }, [loadAccounts]);

  useEffect(() => {
    setSelection(new Set());
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.page, nav.view, nav.slot, deep, debouncedQ, refreshKey, batch, validPicked.join(',')]);

  // Opening a message from elsewhere (dashboard, notification) switches views first.
  const pendingOpen = useRef(null);
  useEffect(() => { setSelectedId(pendingOpen.current); pendingOpen.current = null; }, [nav.view, nav.slot, nav.page]);
  const goToMessage = (m) => {
    const moving = nav.page !== 'mail' || nav.view !== 'inbox' || nav.slot !== null;
    if (moving) { pendingOpen.current = m.id; setNav({ page: 'mail', view: 'inbox', slot: null }); }
    else setSelectedId(m.id);
  };

  useEffect(() => { document.title = totalUnread ? `(${totalUnread}) AskCruz Mailbox` : 'AskCruz Mailbox'; }, [totalUnread]);

  const goToRef = useRef(null);
  goToRef.current = goToMessage;

  // Live updates from the server.
  const loadRef = useRef(loadMessages);
  loadRef.current = loadMessages;
  useEffect(() => {
    const es = new EventSource(eventsUrl());
    let t;
    const soon = () => { clearTimeout(t); t = setTimeout(() => { loadAccounts(); loadRef.current({ silent: true }); }, 2500); };
    es.addEventListener('account-synced', soon);
    es.addEventListener('sync', (e) => { setSync(JSON.parse(e.data)); soon(); });
    es.addEventListener('new-mail', (e) => {
      const d = JSON.parse(e.data);
      const m = d.messages[0];
      toast(m ? `${displayName(m.from)} — ${m.subject}` : `${d.count} new email(s)`, {
        type: 'mail',
        title: `New email in ${d.slot}${d.count > 1 ? ` (+${d.count - 1})` : ''}`,
        duration: 7000,
        action: m && { label: 'Open', onClick: () => goToRef.current(m) },
      });
      soon();
    });
    return () => { es.close(); clearTimeout(t); };
  }, [loadAccounts, toast]);

  // ---------- actions ----------

  const patchLocal = (ids, patch) => setList((l) => ({ ...l, messages: l.messages.map((m) => (ids.includes(m.id) ? { ...m, ...patch } : m)) }));
  const removeLocal = (ids) => {
    setList((l) => {
      const idx = l.messages.findIndex((m) => m.id === selectedId);
      const rest = l.messages.filter((m) => !ids.includes(m.id));
      if (ids.includes(selectedId)) setSelectedId(rest[Math.min(idx, rest.length - 1)]?.id || null);
      return { messages: rest, total: Math.max(0, l.total - ids.length) };
    });
    setSelection(new Set());
  };

  const markRead = async (msgs, seen) => {
    const ids = msgs.map((m) => m.id);
    patchLocal(ids, { seen });
    try {
      await api('/messages', { method: 'PATCH', body: { ids, seen } });
      loadAccounts();
    } catch (e) { toast(e.message, { type: 'error' }); patchLocal(ids, { seen: !seen }); }
  };

  const star = async (m) => {
    patchLocal([m.id], { flagged: !m.flagged });
    try { await api('/messages', { method: 'PATCH', body: { ids: [m.id], flagged: !m.flagged } }); }
    catch (e) { toast(e.message, { type: 'error' }); patchLocal([m.id], { flagged: m.flagged }); }
  };

  const move = async (msgs, to) => {
    const ids = msgs.map((m) => m.id);
    removeLocal(ids);
    try {
      await api('/messages/move', { method: 'POST', body: { ids, to } });
      toast(`${ids.length} conversation${ids.length > 1 ? 's' : ''} ${to === 'trash' ? 'moved to Trash' : to === 'archive' ? 'archived' : `moved to ${to}`}`, { type: 'info', duration: 2500 });
      loadAccounts();
    } catch (e) {
      toast(e.message, { type: 'error' });
      loadMessages({ silent: true });
    }
  };

  const open = (m) => {
    setSelectedId(m.id);
    if (!m.seen) { patchLocal([m.id], { seen: true }); setTimeout(loadAccounts, 1500); }
  };

  const openReply = (m, all, body = '') => {
    if (!m) return;
    const own = accountsBySlot[m.slot]?.email;
    const target = m.folder === 'sent' ? m.to : (m.replyTo?.length ? m.replyTo : [m.from]);
    const extra = [...(m.to || []), ...(m.cc || [])].filter((a) => a.address !== own && !target.some((t) => t.address === a.address));
    setCompose({
      mode: all ? 'replyAll' : 'reply',
      sourceId: m.id,
      from: m.slot,
      subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
      replyToLabel: target.map((t) => t.address).join(', '),
      replyAllExtra: extra.map((a) => a.address).join(', '),
      body,
      signature: false,
    });
  };

  const openForward = (m) => m && setCompose({ mode: 'forward', sourceId: m.id, from: m.slot, subject: /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`, signature: false });

  const refresh = async () => {
    setRefreshing(true);
    if (nav.slot) await api('/sync', { method: 'POST', body: { slot: nav.slot } }).catch(() => {});
    else api('/sync', { method: 'POST', body: {} }).then(() => setSync((s) => ({ ...s, running: true }))).catch(() => {});
    loadAccounts();
    loadMessages({ silent: true });
  };

  const paletteActions = useMemo(() => ({
    page: (page) => setNav((n) => ({ ...n, page })),
    view: (view, slot) => {
      const a = slot && accounts.find((x) => x.slot === slot);
      if (a && batch !== 'all' && String(a.batch) !== batch) setBatch('all');
      setNav({ page: 'mail', view, slot });
    },
    batch: (b) => setBatch(b),
    compose: (slot) => setCompose({ mode: 'new', from: slot || nav.slot || (validPicked[0] || (batch !== 'all' ? visibleAccounts[0]?.slot : undefined)) }),
    theme: toggleTheme,
    sync: () => api('/sync', { method: 'POST', body: {} }).then(() => { setSync((s) => ({ ...s, running: true })); toast('Syncing all mailboxes…', { type: 'info' }); }),
  }), [nav.slot, toggleTheme, toast, accounts, batch, setBatch, visibleAccounts, validPicked]);

  // ---------- keyboard shortcuts ----------

  const selectedMsg = list.messages.find((m) => m.id === selectedId);
  const keyState = useRef({});
  keyState.current = { list, selectedMsg, selectedId, compose, palette };

  useEffect(() => {
    const onKey = (e) => {
      const { list: l, selectedMsg: sm, selectedId: sid, compose: c, palette: p } = keyState.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((x) => !x); return; }
      const tag = document.activeElement?.tagName;
      if (c || p || tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      const idx = l.messages.findIndex((m) => m.id === sid);
      const k = e.key;
      if (k === 'c') { e.preventDefault(); setCompose({ mode: 'new', from: nav.slot || (validPicked[0] || (batch !== 'all' ? visibleAccounts[0]?.slot : undefined)) }); }
      else if (k === 'j' || k === 'ArrowDown') { const n = l.messages[Math.min(idx + 1, l.messages.length - 1)]; if (n) { e.preventDefault(); open(n); } }
      else if (k === 'k' || k === 'ArrowUp') { const n = l.messages[Math.max(idx - 1, 0)]; if (n) { e.preventDefault(); open(n); } }
      else if (k === 'Escape') setSelectedId(null);
      else if (!sm) return;
      else if (k === 'r') { e.preventDefault(); openReply(sm, false); }
      else if (k === 'a') { e.preventDefault(); openReply(sm, true); }
      else if (k === 'f') { e.preventDefault(); openForward(sm); }
      else if (k === 'e') move([sm], 'archive');
      else if (k === '#' || k === 'Delete') move([sm], 'trash');
      else if (k === 's') star(sm);
      else if (k === 'u') { markRead([sm], false); setSelectedId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- render ----------

  const title = nav.slot && selectedAccount
    ? `${VIEW_TITLES[nav.view]} · ${selectedAccount.slot}`
    : nav.view === 'inbox' ? 'Unified Inbox' : VIEW_TITLES[nav.view];
  const subtitle = selectedAccount
    ? `${selectedAccount.name} · ${selectedAccount.designation} · ${selectedAccount.email}`
    : validPicked.length
    ? `${validPicked.length} selected mailbox${validPicked.length > 1 ? 'es' : ''}: ${describeSlots(validPicked)}${nav.view === 'inbox' ? ` · ${totalUnread.toLocaleString()} unread` : ''}`
    : `${batchLabel}${batch === 'all' ? 'All ' : ''}${visibleAccounts.length} mailboxes${nav.view === 'inbox' ? ` · ${totalUnread.toLocaleString()} unread` : ''}`;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        accounts={accounts}
        batches={batches}
        batch={batch}
        setBatch={setBatch}
        picked={validPicked}
        setPicked={setPicked}
        nav={nav}
        setNav={setNav}
        onCompose={() => setCompose({ mode: 'new', from: nav.slot || (validPicked[0] || (batch !== 'all' ? visibleAccounts[0]?.slot : undefined)) })}
        theme={theme}
        toggleTheme={toggleTheme}
        onLogout={onLogout}
        authRequired={authRequired}
        sync={sync}
        onSync={paletteActions.sync}
        onPalette={() => setPalette(true)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="flex min-w-0 flex-1">
        {nav.page === 'dashboard' && (
          <Dashboard
            accounts={scopeAccounts}
            batch={batch}
            slots={validPicked}
            dark={theme === 'dark'}
            refreshKey={sync.lastFullSync}
            onMenu={() => setSidebarOpen(true)}
            onOpenSlot={(slot) => setNav({ page: 'mail', view: 'inbox', slot })}
            onOpenMessage={goToMessage}
          />
        )}
        {nav.page === 'connect' && <ConnectAI onMenu={() => setSidebarOpen(true)} />}
        {nav.page === 'mail' && (
          <>
            <div className={`${selectedId ? 'hidden md:flex' : 'flex'} w-full shrink-0 md:w-[380px] xl:w-[420px]`}>
              <div className="w-full">
                <MessageList
                  title={title}
                  subtitle={subtitle}
                  messages={list.messages}
                  total={list.total}
                  loading={loading}
                  selectedId={selectedId}
                  onOpen={open}
                  selection={selection}
                  setSelection={setSelection}
                  q={q}
                  setQ={setQ}
                  deep={deep}
                  setDeep={setDeep}
                  onRefresh={refresh}
                  refreshing={refreshing}
                  onStar={star}
                  onArchive={(msgs) => move(msgs, 'archive')}
                  onDelete={(msgs) => move(msgs, 'trash')}
                  onMarkRead={markRead}
                  hasMore={CACHED_VIEWS.includes(nav.view) && !(deep && q) && list.messages.length < list.total}
                  onLoadMore={() => loadMessages({ append: true, silent: true })}
                  showSlot={!nav.slot}
                  accountsBySlot={accountsBySlot}
                  onMenu={() => setSidebarOpen(true)}
                />
              </div>
            </div>
            <div className={`${selectedId ? 'flex' : 'hidden md:flex'} min-w-0 flex-1`}>
              <MessageView
                id={selectedId}
                summary={selectedMsg}
                account={selectedId ? accountsBySlot[selectedId.split(':')[0]] : null}
                onBack={() => setSelectedId(null)}
                onReply={openReply}
                onForward={openForward}
                onStar={star}
                onArchive={(msgs) => move(msgs, 'archive')}
                onDelete={(msgs) => move(msgs, 'trash')}
                onMarkRead={(msgs, seen) => { markRead(msgs, seen); if (!seen) setSelectedId(null); }}
                onSent={() => { patchLocal([selectedId], { answered: true }); setTimeout(() => setRefreshKey((k) => k + 1), 1500); }}
              />
            </div>
          </>
        )}
      </main>

      {compose && (
        <Compose
          key={JSON.stringify(compose)}
          init={compose}
          accounts={accounts}
          onClose={() => setCompose(null)}
          onSent={() => { if (compose.sourceId) patchLocal([compose.sourceId], { answered: true }); setTimeout(() => setRefreshKey((k) => k + 1), 1500); }}
        />
      )}
      <CommandPalette open={palette} onClose={() => setPalette(false)} accounts={accounts} batches={batches} actions={paletteActions} />
    </div>
  );
}
