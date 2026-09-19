# AskCruz Mailbox

One premium inbox for every AskCruz SpaceMail mailbox, with an MCP server built in so Claude (or any MCP-capable AI) can read, search and send from any slot.

## Quick start

```bash
npm install
npm run import -- "../AskCruz Mailboxes Id Pass - Batch 1.csv" --batch 1   # CSV sheet export
npm run import -- ../mailboxes_b2.json --batch 2                         # or a JSON file
npm run dev                                                      # API :4000 + web :3000
```

Open http://localhost:3000 and sign in with `APP_PASSWORD` from `.env`.

For a single-process production run: `npm run build && npm start` (serves the UI, API and MCP on http://localhost:4000).

## Batches

Mailboxes are grouped into batches. Batch 1 is slots 1A–50A and batch 2 is slots 1B–50B. Each import merges into `config/mailboxes.json`: re-importing a batch updates its mailboxes, and `--replace` starts over. Restart the server after importing.

- **App:** the All / Batch 1 / Batch 2 switch in the sidebar filters the mailbox list, the unified inbox, unread counts, search and the dashboard. You can also pick a batch from the Ctrl+K palette.
- **MCP:** `list_mailboxes`, `inbox_overview`, `list_emails`, `search_emails` and `list_senders` take an optional `batch` argument, e.g. "show unread emails in batch 2".

## Features

- **Unified inbox** across all mailboxes, synced in the background (IMAP). Live "new mail" toasts.
- **Per-mailbox view** by slot (1A, 2A, …) with Inbox, Sent, Drafts, Archive, Spam and Trash.
- **Send from any slot.** The composer's From picker understands `1A`, `ia`, names and emails. It has recipient chips, Cc/Bcc, attachments (drag and drop), per-mailbox signature, templates with placeholders, locally autosaved drafts, and Ctrl+Enter to send.
- **Reply / Reply all / Forward** with correct threading, plus quick reply from the reading pane.
- **Search** of the recent synced mail (instant), or **Deep search** that queries every mailbox on the server.
- **Dashboard**: mailbox health, unread, replies, 14-day activity, top senders, latest replies.
- **Pick any set of mailboxes.** Click **Select** in the sidebar, then tick mailboxes (Shift-click selects a range) or type slots like `1A-5A, 3B, 7B`. Every view (inbox, unread, sent, search, dashboard) narrows to just those mailboxes. You can save a selection as a named group.
- **Ctrl/Cmd+K command palette** and Gmail-style shortcuts: `c` compose, `j`/`k` navigate, `r` reply, `a` reply all, `f` forward, `e` archive, `#` delete, `s` star, `u` unread, `/` search.
- Remote images blocked by default, emails rendered in a sandboxed frame, and light/dark themes.

## MCP server (connect your AI)

The in-app **Connect AI** page shows copy-paste setup with the right paths.

- **Claude Desktop:** add to `claude_desktop_config.json`:
  ```json
  { "mcpServers": { "askcruz-mailbox": { "command": "node", "args": ["<full path>/server/mcp/stdio.js"] } } }
  ```
- **Claude Code:** `claude mcp add askcruz-mailbox --scope user -- node "<full path>/server/mcp/stdio.js"`
- **HTTP:** `POST http://localhost:4000/mcp` with `Authorization: Bearer <MCP_TOKEN>`. It is available while the app server runs.

The tools are `list_mailboxes`, `inbox_overview`, `list_emails`, `search_emails`, `list_senders`, `read_email`, `send_email`, `reply_to_email`, `forward_email` and `update_emails`. Mailbox arguments accept slot ids (`1A`, `14a`, and typos like `ia`), names, emails or domains.

Example prompts:
- "Send an email from 1A to john@acme.com saying thanks for the call."
- "Who emailed us in the last 3 days?"
- "Show unread mail in 14A."

## Hosting

The app is a long-running Node server. It keeps IMAP connections open, syncs in the background and streams live updates, so it needs an always-on host. Serverless hosts like Vercel and Netlify won't work.

| Host | Fit | Notes |
|---|---|---|
| **Render** (recommended) | Web service, `render.yaml` included | Starter plan (about $7/mo) stays on. The free plan sleeps after 15 minutes idle, which pauses sync and the connector. |
| Railway | Web service | Similar setup: set the same env vars, build `npm ci --include=dev && npm run build`, start `npm start`. |
| Fly.io / any VPS | Docker or plain Node | Full control. Put it behind HTTPS. |

Deploy on Render:

1. Push this repo to GitHub. The mailbox config, `.env` and `data/` are git-ignored and never uploaded.
2. Run `npm run export-env` locally. It writes `data/hosting.env` with `MAILBOXES_JSON` (all mailboxes, base64), `APP_PASSWORD`, `MCP_TOKEN` and `SESSION_SECRET`. Keep this file private.
3. In Render, go to **New → Blueprint**, pick the repo, then paste the four secret values when prompted.
4. After deploy, set `PUBLIC_URL=https://<your-service>.onrender.com` so the app shows the right connector URL.

### Add it to Claude as a connector

1. Open the hosted app, go to **Connect AI**, reveal the **connector URL** (`https://<host>/mcp/<MCP_TOKEN>`) and copy it.
2. In Claude, go to **Settings → Connectors → Add custom connector**, name it *AskCruz Mailbox*, paste the URL and save.
3. Enable it in a chat and ask: "send from 1A to …", "who replied in batch 2 this week?", "show unread in 1A-5A".

The token in the URL is the only credential, so treat the URL like a password. Change `MCP_TOKEN` to revoke access.

## Configuration (`.env`)

| Key | Purpose |
|---|---|
| `APP_PASSWORD` | Dashboard login. Leave empty to disable login (localhost only). |
| `MAILBOXES_JSON` | Mailbox list as JSON or base64 (for hosting). Overrides `config/mailboxes.json`. |
| `PUBLIC_URL` | Public base URL, used to show the connector URL. |
| `SESSION_SECRET` | Signs login sessions. Set it on hosts so logins survive restarts. |
| `MCP_TOKEN` | Bearer token for the HTTP `/mcp` endpoint. Leave empty to disable it. |
| `PORT`, `HOST` | API server bind address (default `127.0.0.1:4000`). |
| `SYNC_INTERVAL_SEC` | Background sync interval (default 120). |
| `INBOX_DEPTH`, `SENT_DEPTH` | Messages cached per mailbox for the unified views. |
| `MAX_IMAP_CONNECTIONS` | IMAP connection pool size (default 50: one per mailbox). |

## Security notes

- `config/mailboxes.json`, `.env` and `data/` contain credentials, tokens and cached mail. They are git-ignored, so never commit or share them.
- The server binds to `127.0.0.1` by default. Before exposing it (tunnel or deploy), keep `APP_PASSWORD` and `MCP_TOKEN` set and use HTTPS.

## Project layout

```
server/
  config.js          mailbox loading + slot resolution ("ia" -> 1A)
  mail/pool.js       IMAP connection pool
  mail/service.js    list / read / search / flags / move / send / reply / forward
  mail/store.js      background sync cache powering the unified inbox
  mcp/tools.js       MCP tool definitions (shared by stdio + HTTP)
  mcp/stdio.js       stdio entry for Claude Desktop / Code
  index.js           REST API, SSE live updates, /mcp, static hosting
src/                 React + Tailwind UI
scripts/import-mailboxes.js   CSV sheet -> config/mailboxes.json
```
