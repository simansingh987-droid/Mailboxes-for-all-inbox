import { useEffect, useState } from 'react';
import { Inbox, MailOpen, Reply, Send, ServerCog, Menu, AlertTriangle, CheckCircle2, Table2, BarChart3 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Avatar, Spinner } from './ui.jsx';
import { relative, displayName } from '../lib/format.js';

// Validated two-series palette (dataviz validator, light + dark surfaces).
const SERIES = {
  received: { label: 'Received', light: '#3569c8', dark: '#5b8fe6' },
  sent: { label: 'Sent', light: '#0e9f8a', dark: '#159e89' },
};

function Kpi({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-card dark:border-white/5 dark:bg-ink-900">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300"><Icon size={15} /></span>
        {label}
      </div>
      <div className="mt-3 font-display text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function ActivityChart({ days, dark }) {
  const [hover, setHover] = useState(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...days.flatMap((d) => [d.received, d.sent]));
  const step = max <= 10 ? 2 : max <= 50 ? 10 : max <= 200 ? 20 : 50;
  const nice = Math.ceil(max / step) * step;
  const W = 640, H = 220, padL = 32, padB = 26, padT = 10;
  const plotW = W - padL - 8, plotH = H - padB - padT;
  const group = plotW / days.length;
  const barW = Math.min(14, (group - 10) / 2);
  const y = (v) => padT + plotH - (v / nice) * plotH;
  const color = (k) => (dark ? SERIES[k].dark : SERIES[k].light);
  const tickStep = step * Math.ceil(nice / step / 4);
  const ticks = Array.from({ length: Math.floor(nice / tickStep) + 1 }, (_, i) => i * tickStep);
  const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-white/5 dark:bg-ink-900">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-display text-sm font-bold text-slate-900 dark:text-white">Mail activity · last 14 days</div>
          <div className="text-xs text-slate-400">Across all mailboxes (recent sync window)</div>
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
          {Object.keys(SERIES).map((k) => (
            <span key={k} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color(k) }} />{SERIES[k].label}</span>
          ))}
          <button className="icon-btn h-7 w-7" title={table ? 'Show chart' : 'Show table'} onClick={() => setTable(!table)}>{table ? <BarChart3 size={14} /> : <Table2 size={14} />}</button>
        </div>
      </div>
      {table ? (
        <div className="mt-4 max-h-[240px] overflow-auto text-sm">
          <table className="w-full text-left">
            <thead className="text-xs text-slate-400"><tr><th className="py-1 font-medium">Day</th><th className="font-medium">Received</th><th className="font-medium">Sent</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.date} className="border-t border-slate-100 dark:border-white/5"><td className="py-1.5">{fmtDay(d.date)}</td><td>{d.received}</td><td>{d.sent}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative mt-4">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Received and sent emails per day">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="stroke-slate-100 dark:stroke-white/5" />
                <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">{t}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const x0 = padL + i * group + (group - barW * 2 - 2) / 2;
              return (
                <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <rect x={padL + i * group} y={padT} width={group} height={plotH} fill={hover === i ? (dark ? 'rgba(255,255,255,.04)' : 'rgba(15,23,42,.035)') : 'transparent'} />
                  {['received', 'sent'].map((k, j) => {
                    const v = d[k];
                    const h = Math.max(v ? 2 : 0, (v / nice) * plotH);
                    const x = x0 + j * (barW + 2);
                    const r = Math.min(4, barW / 2, h);
                    const top = padT + plotH - h;
                    return v ? (
                      <path key={k} fill={color(k)} d={`M${x},${padT + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${padT + plotH} Z`} />
                    ) : null;
                  })}
                  {(i % 2 === 0 || days.length <= 7) && (
                    <text x={padL + i * group + group / 2} y={H - 8} textAnchor="middle" className="fill-slate-400 text-[10px]">{fmtDay(d.date)}</text>
                  )}
                </g>
              );
            })}
            <line x1={padL} x2={W - 8} y1={padT + plotH} y2={padT + plotH} className="stroke-slate-200 dark:stroke-white/10" />
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl dark:border-ink-600 dark:bg-ink-800"
              style={{ left: `${((padL + hover * group + group / 2) / W) * 100}%` }}
            >
              <div className="mb-1 font-semibold text-slate-900 dark:text-white">{fmtDay(days[hover].date)}</div>
              {Object.keys(SERIES).map((k) => (
                <div key={k} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className="h-2 w-2 rounded-sm" style={{ background: color(k) }} />{SERIES[k].label}<span className="ml-auto pl-4 font-semibold text-slate-900 dark:text-white">{days[hover][k]}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ accounts, batch = 'all', slots = [], onOpenSlot, onOpenMessage, onMenu, dark, refreshKey }) {
  const [stats, setStats] = useState(null);
  const [replies, setReplies] = useState([]);

  useEffect(() => {
    const bq = slots.length ? `slots=${slots.join(',')}` : batch === 'all' ? '' : `batch=${batch}`;
    api(`/stats?${bq}`).then(setStats).catch(() => {});
    api(`/messages?view=inbox&limit=200&${bq}`).then((r) => {
      const own = new Set(accounts.map((a) => a.email));
      setReplies(r.messages.filter((m) => /^re:/i.test(m.subject) && !own.has(m.from.address)).slice(0, 6));
    }).catch(() => {});
  }, [refreshKey, accounts.length, batch, slots.join(',')]);

  if (!stats) return <div className="flex h-full flex-1 items-center justify-center"><Spinner size={22} className="text-brand-500" /></div>;
  const maxUnread = Math.max(1, ...accounts.map((a) => a.unread));

  return (
    <div className="h-full flex-1 overflow-y-auto">
      <div className="brand-gradient relative overflow-hidden px-6 pb-20 pt-6 text-white">
        <img src="/logo.webp" alt="" className="pointer-events-none absolute -right-10 -top-10 w-80 opacity-[.08]" />
        <div className="flex items-center gap-2">
          <button className="rounded-lg p-1.5 hover:bg-white/10 lg:hidden" onClick={onMenu}><Menu size={18} /></button>
          <div>
            <div className="text-xs font-medium uppercase tracking-widest text-brand-300">Command center{slots.length ? ` · ${slots.length} selected mailboxes` : batch !== 'all' ? ` · Batch ${batch}` : ''}</div>
            <h1 className="font-display text-2xl font-extrabold">Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'} 👋</h1>
            <p className="text-sm text-brand-200">{stats.unread.toLocaleString()} unread across {stats.mailboxes} mailboxes · synced {relative(stats.lastFullSync)}</p>
          </div>
        </div>
      </div>

      <div className="relative z-10 -mt-14 space-y-5 px-4 pb-10 sm:px-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Kpi icon={ServerCog} label="Mailboxes online" value={`${stats.healthy}/${stats.mailboxes}`} hint={stats.failing.length ? `${stats.failing.length} need attention` : 'All connected'} />
          <Kpi icon={MailOpen} label="Unread" value={stats.unread.toLocaleString()} hint="Across every inbox" />
          <Kpi icon={Inbox} label="Received" value={stats.received.toLocaleString()} hint="In the synced window" />
          <Kpi icon={Reply} label="Replies" value={stats.replies.toLocaleString()} hint="Messages with Re:" />
          <Kpi icon={Send} label="Sent" value={stats.sent.toLocaleString()} hint="In the synced window" />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0"><ActivityChart days={stats.days} dark={dark} /></div>
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-white/5 dark:bg-ink-900">
            <div className="font-display text-sm font-bold text-slate-900 dark:text-white">Top senders</div>
            <div className="text-xs text-slate-400">External people writing in most</div>
            <div className="mt-3 space-y-2.5">
              {stats.topSenders.map((s) => (
                <div key={s.address} className="flex items-center gap-3">
                  <Avatar person={s} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{displayName(s)}</div>
                    <div className="truncate text-[11px] text-slate-400">{s.address} · {s.slots.length} mailbox{s.slots.length > 1 && 'es'}</div>
                  </div>
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{s.count}</span>
                </div>
              ))}
              {!stats.topSenders.length && <div className="text-sm text-slate-400">No external mail yet.</div>}
            </div>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-white/5 dark:bg-ink-900">
            <div className="font-display text-sm font-bold text-slate-900 dark:text-white">Latest replies</div>
            <div className="text-xs text-slate-400">People responding to your outreach</div>
            <div className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
              {replies.map((m) => (
                <button key={m.id} onClick={() => onOpenMessage(m)} className="flex w-full items-center gap-3 py-2.5 text-left hover:opacity-80">
                  <Avatar person={m.from} size={30} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`truncate text-sm ${m.seen ? 'text-slate-700 dark:text-slate-300' : 'font-semibold text-slate-900 dark:text-white'}`}>{displayName(m.from)}</span>
                      <span className="slot-badge">{m.slot}</span>
                    </div>
                    <div className="truncate text-xs text-slate-400">{m.subject} — {m.snippet}</div>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">{relative(new Date(m.date).getTime())}</span>
                </button>
              ))}
              {!replies.length && <div className="py-4 text-sm text-slate-400">No replies yet.</div>}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-white/5 dark:bg-ink-900">
            <div className="flex items-center">
              <div>
                <div className="font-display text-sm font-bold text-slate-900 dark:text-white">Mailbox health</div>
                <div className="text-xs text-slate-400">Shade shows unread volume · click a slot to open it</div>
              </div>
              {stats.failing.length === 0 ? (
                <span className="ml-auto flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={14} /> All healthy</span>
              ) : (
                <span className="ml-auto flex items-center gap-1 text-xs font-medium text-rose-600"><AlertTriangle size={14} /> {stats.failing.length} failing</span>
              )}
            </div>
            <div className="mt-4 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
              {accounts.map((a) => {
                const t = a.unread / maxUnread;
                return (
                  <button
                    key={a.slot}
                    onClick={() => onOpenSlot(a.slot)}
                    title={`${a.slot} · ${a.name}\n${a.email}\n${a.unread} unread${a.error ? `\n⚠ ${a.error}` : ''}`}
                    className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-[10px] font-semibold transition hover:scale-105 hover:ring-2 hover:ring-brand-400 ${
                      a.status === 'error' ? 'bg-rose-500 text-white' : t > 0.5 ? 'text-white' : 'text-brand-900 dark:text-brand-100'
                    }`}
                    style={a.status === 'error' ? undefined : { background: `rgba(${dark ? '91,143,230' : '45,74,115'}, ${0.08 + t * 0.85})` }}
                  >
                    {a.slot}
                    {a.unread > 0 && <span className="text-[9px] font-medium opacity-80">{a.unread}</span>}
                  </button>
                );
              })}
            </div>
            {stats.failing.length > 0 && (
              <div className="mt-3 space-y-1 text-xs text-rose-600 dark:text-rose-400">
                {stats.failing.map((f) => <div key={f.slot}><b>{f.slot}</b> {f.email}: {f.error}</div>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
