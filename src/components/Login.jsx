import { useState } from 'react';
import { Lock, ArrowRight, ShieldCheck, Inbox, Bot } from 'lucide-react';
import { api, auth } from '../lib/api.js';
import { Spinner } from './ui.jsx';

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } = await api('/login', { method: 'POST', body: { password } });
      auth.set(token);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="brand-gradient relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-white to-silver-300 shadow-lg">
            <img src="/logo.webp" alt="" className="w-8" />
          </div>
          <div className="font-display text-lg font-extrabold">AskCruz <span className="silver-text">Mailbox</span></div>
        </div>
        <div>
          <img src="/logo.webp" alt="" className="pointer-events-none absolute -right-24 top-1/2 w-[34rem] -translate-y-1/2 opacity-[.07]" />
          <h1 className="font-display text-4xl font-extrabold leading-tight">
            Every AskCruz inbox.<br /><span className="silver-text">One command center.</span>
          </h1>
          <p className="mt-4 max-w-md text-brand-200">Read, search and send from all of your mailboxes in one place — and let your AI assistant do the same through MCP.</p>
          <div className="mt-8 grid max-w-md gap-3 text-sm">
            {[
              [Inbox, 'Unified inbox across every slot, synced in the background'],
              [Bot, 'Built-in MCP server: "send from 1A", "who replied today?"'],
              [ShieldCheck, 'Credentials stay on this machine — nothing is sent to third parties'],
            ].map(([Icon, text]) => (
              <div key={text} className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
                <Icon size={18} className="text-silver-300" />
                <span className="text-brand-100">{text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="text-xs text-brand-300">© {new Date().getFullYear()} AskCruz</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm animate-fade-in">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-white to-silver-300 shadow-card ring-1 ring-black/5">
              <img src="/logo.webp" alt="" className="w-8" />
            </div>
            <div className="font-display text-lg font-extrabold text-brand-900 dark:text-white">AskCruz Mailbox</div>
          </div>
          <h2 className="font-display text-2xl font-extrabold text-slate-900 dark:text-white">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Enter the workspace password to open your mailboxes.</p>
          <label className="mt-8 block text-xs font-semibold uppercase tracking-wider text-slate-500">Password</label>
          <div className="relative mt-2">
            <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input autoFocus type="password" className="input py-2.5 pl-9" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
          </div>
          {error && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</div>}
          <button className="btn-primary mt-6 w-full py-2.5" disabled={busy || !password}>
            {busy ? <Spinner /> : <>Sign in <ArrowRight size={16} /></>}
          </button>
          <p className="mt-6 text-center text-xs text-slate-400">The password is set as APP_PASSWORD in the server's .env file.</p>
        </form>
      </div>
    </div>
  );
}
