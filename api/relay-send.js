// Vercel function: sends one pre-built email over SMTP for the backend.
// The backend runs on a host that blocks outbound SMTP ports, so it POSTs the raw message here.
// Protected by RELAY_SECRET, and limited to the mail hosts in RELAY_ALLOWED_HOSTS so it can
// never be used as an open relay.
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';

export const config = { maxDuration: 60 };

const allowedHosts = () =>
  (process.env.RELAY_ALLOWED_HOSTS || 'mail.spacemail.com').split(',').map((h) => h.trim().toLowerCase());

function secretOk(given) {
  const expected = process.env.RELAY_SECRET || '';
  if (!expected || !given) return false;
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!secretOk(req.headers['x-relay-secret'])) return res.status(401).json({ error: 'Invalid relay secret' });

  const { smtp, envelope, raw } = req.body || {};
  if (!smtp?.host || !smtp?.user || !smtp?.pass || !envelope?.from || !envelope?.to?.length || !raw) {
    return res.status(400).json({ error: 'Missing smtp, envelope or raw' });
  }
  if (!allowedHosts().includes(String(smtp.host).toLowerCase())) {
    return res.status(403).json({ error: `SMTP host ${smtp.host} is not allowed` });
  }
  if (String(envelope.from).toLowerCase() !== String(smtp.user).toLowerCase()) {
    return res.status(400).json({ error: 'Envelope sender must match the authenticated mailbox' });
  }

  const port = Number(smtp.port) || 465;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: smtp.secure ?? port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 20000,
  });
  try {
    const info = await transport.sendMail({ envelope, raw: Buffer.from(raw, 'base64') });
    return res.status(200).json({ messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
  } catch (err) {
    return res.status(502).json({ error: err.response || err.message });
  } finally {
    transport.close();
  }
}
