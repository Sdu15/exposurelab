/**
 * POST /api/audit — intake for the free 4-point funnel audit form
 *                    (hkexposurelab.com and /free-audit.html).
 *
 * Every real submission is
 *   1. validated server-side (email, website, honeypot, rate limit),
 *   2. stored   — Cloudflare KV (binding LEADS) and/or Airtable,
 *   3. notified — email to hello@hkexposurelab.com via Resend.
 *
 * A lead is only reported as accepted when at least one store or the
 * notification succeeded, so the browser never shows a false "sent".
 *
 * Binding / env vars (Cloudflare Pages project → Settings → Variables and
 * Secrets, Production):
 *   LEADS               KV namespace binding — durable copy + rate limiting
 *   AIRTABLE_API_KEY    Airtable PAT (data.records:write on the base)
 *   AIRTABLE_BASE_ID    e.g. appXXXXXXXXXXXXXX
 *   AIRTABLE_TABLE_NAME e.g. Leads
 *   RESEND_API_KEY      Resend API key (sends the notification email)
 *   AUDIT_TO            recipient  (default hello@hkexposurelab.com)
 *   AUDIT_FROM          verified sender (default Exposure Lab <audit@hkexposurelab.com>)
 *   ADMIN_TOKEN         lets you GET the stored leads back out (see below)
 *
 * GET /api/audit?token=<ADMIN_TOKEN>&format=json|csv   export stored leads
 */

const MAX_BODY = 8 * 1024;
const RATE_LIMIT_MAX = 4;         // submissions per IP …
const RATE_LIMIT_WINDOW = 60;     // … per 60 seconds (KV requires >= 60)
const DEFAULT_TO = 'hello@hkexposurelab.com';

// Pragmatic RFC-5321-ish check: no spaces, one @, a real looking domain.
const EMAIL_RE = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?:\/\S*)?$/;
const HANDLE_RE = /^@?[a-z0-9](?:[a-z0-9._-]{1,58})[a-z0-9]$/;

// Throwaway inboxes: an audit reply that bounces is worse than no lead.
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'sharklasers.com', 'grr.la', '10minutemail.com',
  'tempmail.com', 'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'getnada.com', 'maildrop.cc', 'dispostable.com', 'fakeinbox.com', 'mailnesia.com',
]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Error('too_large');
  const ctype = (request.headers.get('content-type') || '').toLowerCase();
  if (ctype.includes('application/json')) {
    try {
      const parsed = JSON.parse(text || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad_json');
      return parsed;
    } catch {
      throw new Error('bad_json');
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

const str = (v, max = 250) => String(v ?? '').trim().slice(0, max);

/** Returns an error string, or null when the address is usable. */
function checkEmail(raw) {
  const email = str(raw, 254).toLowerCase();
  if (!email) return 'Enter your email address.';
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : '';
  const domain = at > 0 ? email.slice(at + 1) : '';
  if (!local || !domain) return 'That email address is missing an “@” or a domain.';
  if (local.length > 64) return 'That email address is too long.';
  if (email.includes('..') || !EMAIL_RE.test(email)) return 'That email address does not look right — check for typos.';
  if (DISPOSABLE.has(domain)) return 'Please use your business email address.';
  return null;
}

/** Returns { value } or { error }. */
function checkSite(raw) {
  let site = str(raw, 200);
  if (!site) return { error: 'Add your website or Instagram handle.' };
  if (/\s/.test(site)) return { error: 'Website or Instagram handle — no spaces.' };
  site = site.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
  if (!DOMAIN_RE.test(site) && !HANDLE_RE.test(site)) {
    return { error: 'That does not look like a domain or an @handle — e.g. yourbusiness.hk' };
  }
  return { value: site };
}

const hostOf = (site) => String(site).replace(/^@/, '').split('/')[0].split(':')[0];

async function rateLimited(env, ip) {
  if (!ip || !env.LEADS?.get || !env.LEADS?.put) return false;
  const key = `rl:${ip}`;
  const used = parseInt((await env.LEADS.get(key)) || '0', 10) || 0;
  if (used >= RATE_LIMIT_MAX) return true;
  await env.LEADS.put(key, String(used + 1), { expirationTtl: RATE_LIMIT_WINDOW });
  return false;
}

async function storeKv(env, key, lead) {
  if (!env.LEADS?.put) throw new Error('no_LEADS_binding');
  await env.LEADS.put(key, JSON.stringify(lead));
}

async function storeAirtable(env, lead) {
  const { AIRTABLE_API_KEY: key, AIRTABLE_BASE_ID: base, AIRTABLE_TABLE_NAME: table } = env;
  if (!key || !base || !table) throw new Error('airtable_not_configured');
  const res = await fetch(
    `https://api.airtable.com/v0/${base}/${encodeURIComponent(table)}`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        typecast: true,
        fields: {
          'Company name': hostOf(lead.site).split('.')[0],
          'Email': lead.email,
          'Website': lead.site,
          'Source': 'Free audit form — website',
          'Status': 'New',
          'Notes': lead.notes,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`airtable_${res.status}_${(await res.text()).slice(0, 160)}`);
  return res.json();
}

async function notify(env, lead) {
  const key = env.RESEND_API_KEY;
  if (!key) throw new Error('resend_not_configured');
  const to = env.AUDIT_TO || DEFAULT_TO;
  const from = env.AUDIT_FROM || 'Exposure Lab <audit@hkexposurelab.com>';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: lead.email,
      subject: `Free audit request — ${lead.site || lead.email}`,
      text: leadEmailText(lead),
      html: leadEmailHtml(lead, to),
    }),
  });
  if (!res.ok) throw new Error(`resend_${res.status}_${(await res.text()).slice(0, 160)}`);
  return res.json();
}

const leadEmailText = (l) =>
  `New free-audit request\n\n` +
  `Email:    ${l.email}\n` +
  `Website:  ${l.site}\n` +
  `Page:     ${l.page}\n` +
  `Received: ${l.ts}\n` +
  `Referrer: ${l.ref || '—'}\n` +
  (l.utm && Object.keys(l.utm).length ? `Campaign: ${new URLSearchParams(l.utm)}\n` : '') +
  `\nReply to this email to answer them directly.\n`;

const leadEmailHtml = (l) => {
  const rows = [
    ['Email', `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>`],
    ['Website / Instagram', esc(l.site)],
    ['Form page', esc(l.page)],
    ['Received', esc(l.ts)],
    ['Referrer', esc(l.ref || '—')],
    ...(l.utm && Object.keys(l.utm).length ? [['Campaign', esc(new URLSearchParams(l.utm).toString())]] : []),
  ];
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;color:#141b39;line-height:1.5">
  <h2 style="margin:0 0 4px;font-size:19px">New free-audit request</h2>
  <p style="margin:0 0 16px;color:#667085">Answer this email to reply to them directly.</p>
  <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    ${rows.map(([k, v]) => `<tr><td style="padding:6px 14px 6px 0;color:#667085;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:600">${v}</td></tr>`).join('')}
  </table>
  <p style="margin:18px 0 0"><a href="https://hkexposurelab.com/free-audit.html" style="color:#427fe0">The 4-point audit checklist →</a></p>
</div>`;
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await readBody(request);
  } catch (err) {
    const msg = err.message === 'too_large' ? 'That request was too large.' : 'Could not read the form.';
    return json({ ok: false, error: err.message, message: msg }, 400);
  }

  // Hidden field only a bot fills in: accept silently, store nothing.
  if (str(body.company_url)) return json({ ok: true, stored: [], notified: null }, 200);

  const fields = {};
  const emailErr = checkEmail(body.email);
  if (emailErr) fields.email = emailErr;
  const site = checkSite(body.site);
  if (site.error) fields.site = site.error;

  const email = str(body.email, 254).toLowerCase();
  if (Object.keys(fields).length) {
    return json({ ok: false, error: 'invalid', fields, message: 'Please fix the highlighted fields.' }, 422);
  }

  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (body[k]) utm[k] = str(body[k], 120);
  }

  const lead = {
    email,
    site: site.value,
    company: hostOf(site.value).split('.')[0],
    page: str(body.page, 120) || '/',
    source: str(body.source, 60) || 'website form',
    ref: str(body.ref, 300),
    utm,
    ts: new Date().toISOString(),
    ip_country: request.headers.get('cf-ipcountry') || '',
    ua: str(request.headers.get('user-agent'), 300),
    notes: [
      `Inbound free-audit request from ${str(body.page, 120) || 'hkexposurelab.com'}.`,
      body.notes ? str(body.notes, 800) : '',
    ].filter(Boolean).join(' '),
  };

  const ip = request.headers.get('cf-connecting-ip') || '';
  if (await rateLimited(env, ip)) {
    return json(
      { ok: false, error: 'rate_limited', message: 'That is a lot of requests — please email hello@hkexposurelab.com and we will pick it up.' },
      429,
    );
  }

  const stored = [];
  const failed = [];
  const key = `lead:${lead.ts}:${crypto.randomUUID().slice(0, 8)}`;

  try {
    await storeKv(env, key, lead);
    stored.push('kv');
  } catch (err) {
    failed.push(`kv:${err.message}`);
  }

  try {
    const rec = await storeAirtable(env, lead);
    stored.push('airtable');
    if (rec?.id) lead.airtable_id = rec.id;
    if (env.LEADS?.put) await env.LEADS.put(key, JSON.stringify(lead)).catch(() => {});
  } catch (err) {
    failed.push(`airtable:${err.message}`);
  }

  let notified = null;
  try {
    await notify(env, lead);
    notified = 'resend';
  } catch (err) {
    failed.push(`notify:${err.message}`);
  }

  if (!stored.length && !notified) {
    // Nothing captured anywhere: tell the truth so the page can offer the fallback.
    console.error('audit intake failed', JSON.stringify({ email: lead.email, failed }));
    return json(
      {
        ok: false,
        error: 'not_captured',
        failed,
        message: `We could not save that — please email ${DEFAULT_TO} and we will pick it up.`,
      },
      502,
    );
  }

  return json({ ok: true, stored, notified, failed }, 200);
}

/** GET /api/audit?token=…&format=json|csv — export what has been captured. */
export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || request.headers.get('x-admin-token') || '';
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) return new Response('Not found', { status: 404 });
  if (!env.LEADS?.list) return json({ ok: false, error: 'no_LEADS_binding' }, 503);

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000', 10) || 1000, 1000);
  const list = await env.LEADS.list({ prefix: 'lead:', limit });
  const leads = [];
  for (const k of list.keys) {
    const raw = await env.LEADS.get(k.name);
    if (raw) {
      try {
        leads.push(JSON.parse(raw));
      } catch {
        /* skip unreadable record */
      }
    }
  }
  leads.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));

  if ((url.searchParams.get('format') || 'json').toLowerCase() === 'csv') {
    const cols = ['ts', 'email', 'site', 'company', 'page', 'source', 'ref', 'ip_country'];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...leads.map((l) => cols.map((c) => cell(l[c])).join(','))].join('\r\n');
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="exposurelab-free-audit-leads.csv"',
        'cache-control': 'no-store',
      },
    });
  }
  return json({ ok: true, count: leads.length, leads });
}
