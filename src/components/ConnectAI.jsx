import { useEffect, useState } from 'react';
import { Bot, Copy, Check, Terminal, Globe, Monitor, Menu, Eye, EyeOff, Sparkles, Plug } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from './ui.jsx';

function CodeBlock({ code, label }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative mt-3 overflow-hidden rounded-xl bg-ink-950 ring-1 ring-white/10">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-2 text-[11px] font-medium text-slate-400">
        {label}
        <button
          className="flex items-center gap-1 rounded-md px-2 py-0.5 text-slate-300 hover:bg-white/10"
          onClick={() => { navigator.clipboard?.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-brand-100">{code}</pre>
    </div>
  );
}

const TOOL_INFO = {
  list_mailboxes: 'Find a mailbox by slot (1A…), name, email or domain',
  inbox_overview: 'Unread per mailbox, top senders, latest replies',
  list_emails: 'Latest emails — all mailboxes or one slot, any folder',
  search_emails: 'Server-side search by sender, subject, text, date',
  list_senders: '“Who emailed me this week?” grouped by sender',
  read_email: 'Full body, headers and attachment names',
  send_email: 'Send from a specific slot, with optional signature',
  reply_to_email: 'Threaded reply / reply-all from the receiving slot',
  forward_email: 'Forward with attachments',
  update_emails: 'Mark read/unread, star, archive, trash, spam',
};

const PROMPTS = [
  'Send an email from 1A to john@acme.com saying thanks for the call today.',
  'Who replied to us in the last 3 days? Group them by slot.',
  'Show me unread emails in 14A.',
  'Show the latest emails in 1A-5A and 3B.',
  'Reply to the latest reply in 2A: “Great, let’s talk Tuesday.”',
  'Which mailboxes have the most unread mail?',
];

export default function ConnectAI({ onMenu }) {
  const [info, setInfo] = useState(null);
  const [showToken, setShowToken] = useState(false);
  const toast = useToast();

  useEffect(() => { api('/mcp-info').then(setInfo).catch((e) => toast(e.message, { type: 'error' })); }, []);
  if (!info) return null;

  const desktop = JSON.stringify({ mcpServers: { 'askcruz-mailbox': { command: 'node', args: [info.stdioPath] } } }, null, 2);
  const claudeCode = `claude mcp add askcruz-mailbox --scope user -- node "${info.stdioPath}"`;
  const origin = info.publicUrl || `${window.location.protocol}//${window.location.host}`;
  const isLocal = /localhost|127\.0\.0\.1/.test(origin);
  const connectorUrl = info.connectorPath ? `${origin}${showToken ? info.connectorPath : '/mcp/' + '•'.repeat(16)}` : 'Set MCP_TOKEN to enable';
  const token = info.token ? (showToken ? info.token : '•'.repeat(24)) : '<set MCP_TOKEN in .env>';
  const http = `URL:     ${origin}${info.httpPath}
Header:  Authorization: Bearer ${token}
Transport: Streamable HTTP (stateless, JSON responses)`;

  return (
    <div className="h-full flex-1 overflow-y-auto">
      <div className="brand-gradient relative overflow-hidden px-6 pb-8 pt-6 text-white">
        <img src="/logo.webp" alt="" className="pointer-events-none absolute -right-8 top-2 w-72 opacity-[.08]" />
        <div className="flex items-start gap-3">
          <button className="rounded-lg p-1.5 hover:bg-white/10 lg:hidden" onClick={onMenu}><Menu size={18} /></button>
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15"><Bot size={22} /></div>
          <div>
            <h1 className="font-display text-2xl font-extrabold">Connect your AI</h1>
            <p className="max-w-2xl text-sm text-brand-200">
              AskCruz Mailbox ships an MCP server. Connect it to Claude (or any MCP-capable AI) and manage all mailboxes by chat —
              “send from 1A”, “who replied today?”, “read the latest email in 14A”.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-5 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <section className="rounded-2xl border border-brand-200 bg-white p-5 shadow-card ring-1 ring-brand-100 dark:border-brand-800 dark:bg-ink-900 dark:ring-brand-900">
            <div className="flex items-center gap-2 font-display font-bold text-slate-900 dark:text-white">
              <Plug size={17} className="text-brand-500" /> Claude connector (claude.ai, Desktop & mobile)
              {info.connectorPath && (
                <button className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-white" onClick={() => setShowToken(!showToken)}>
                  {showToken ? <EyeOff size={13} /> : <Eye size={13} />} {showToken ? 'Hide' : 'Reveal'}
                </button>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              In Claude: <b>Settings → Connectors → Add custom connector</b>, name it “AskCruz Mailbox”, and paste this URL.
              The secret in the URL is your MCP_TOKEN — treat the whole URL like a password.
            </p>
            <CodeBlock label="connector URL" code={connectorUrl} />
            {isLocal && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                This app is running on your computer, which Claude’s servers can’t reach. Deploy it (see README → Hosting) and use the hosted URL here.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-white/5 dark:bg-ink-900">
            <div className="flex items-center gap-2 font-display font-bold text-slate-900 dark:text-white"><Monitor size={17} className="text-brand-500" /> Claude Desktop (local)</div>
            <p className="mt-1 text-sm text-slate-500">Settings → Developer → Edit Config, paste this into <code className="rounded bg-slate-100 px-1 dark:bg-ink-800">claude_desktop_config.json</code>, then restart Claude.</p>
            <CodeBlock label="claude_desktop_config.json" code={desktop} />
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-white/5 dark:bg-ink-900">
            <div className="flex items-center gap-2 font-display font-bold text-slate-900 dark:text-white"><Terminal size={17} className="text-brand-500" /> Claude Code</div>
            <p className="mt-1 text-sm text-slate-500">Run once in a terminal. The server reads the same mailbox config as this app.</p>
            <CodeBlock label="terminal" code={claudeCode} />
          </section>

          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-white/5 dark:bg-ink-900">
            <div className="flex items-center gap-2 font-display font-bold text-slate-900 dark:text-white">
              <Globe size={17} className="text-brand-500" /> Any AI over HTTP
              {info.token && (
                <button className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 dark:hover:text-white" onClick={() => setShowToken(!showToken)}>
                  {showToken ? <EyeOff size={13} /> : <Eye size={13} />} {showToken ? 'Hide' : 'Reveal'} token
                </button>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-500">
              For clients that connect to an MCP URL. This endpoint runs while the app server is running. To use it from cloud AIs
              (claude.ai, ChatGPT), expose the server through a secure tunnel or deploy it, and keep the token secret.
            </p>
            <CodeBlock label="remote MCP endpoint" code={http} />
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-white/5 dark:bg-ink-900">
            <div className="font-display text-sm font-bold text-slate-900 dark:text-white">Tools your AI gets</div>
            <div className="mt-3 space-y-2.5">
              {Object.entries(TOOL_INFO).map(([name, desc]) => (
                <div key={name}>
                  <code className="text-[12px] font-semibold text-brand-700 dark:text-brand-300">{name}</code>
                  <div className="text-xs text-slate-500">{desc}</div>
                </div>
              ))}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-white/5 dark:bg-ink-900">
            <div className="flex items-center gap-2 font-display text-sm font-bold text-slate-900 dark:text-white"><Sparkles size={15} className="text-brand-500" /> Try asking</div>
            <div className="mt-3 space-y-2">
              {PROMPTS.map((p) => (
                <button key={p} onClick={() => { navigator.clipboard?.writeText(p); toast('Prompt copied', { type: 'info', duration: 1500 }); }} className="block w-full rounded-lg bg-slate-50 px-3 py-2 text-left text-xs text-slate-600 transition hover:bg-brand-50 hover:text-brand-800 dark:bg-ink-800 dark:text-slate-300 dark:hover:bg-brand-900/40">
                  “{p}”
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
