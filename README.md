# hkexposurelab.com

Static marketing site for **Exposure Lab** (Hong Kong funnel-diagnosis agency).

* Live: <https://hkexposurelab.com> — Cloudflare Pages, project `hermesworkspace`, deployed
  **from the root of this repo** on every push to `main`.
* No build step, no framework: plain HTML/CSS + one small JS file, plus Pages Functions for
  the free-audit intake endpoint.
* **This repo is public.** `.gitignore` is deny-by-default: only the files the site serves
  (and `functions/`) are tracked. Never `git add .` — run `git status` first.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Landing page. The free-audit form lives inline in the hero (`#free-audit`). |
| `free-audit.html` | The free-audit **request form only** (dark, its own design) — served at `/free-audit`. Landing in a campaign link or the header CTA still works. |
| `detailed-audit.html` | The HK$3,000 detailed-audit page (dark). Served at `/detailed-audit`. |
| `audit-form.js` | Shared client-side form logic: validation, `POST /api/audit`, success/error states. |
| `functions/api/audit.js` | The intake endpoint (Cloudflare Pages Function) — see below. |
| `robots.txt`, `sitemap.xml`, `llms.txt` | Crawler files. Clean URLs only (Cloudflare 308-redirects `*.html`). |
| `audit-reminder.ics` | Calendar file offered on the free-audit page. |

**Note:** Cloudflare Pages serves `/free-audit` and 308-redirects `/free-audit.html`, so all
canonicals, sitemap entries and `llms.txt` links use the extensionless URL.

## The free-audit form (leads)

`POST /api/audit` is the only moving part. Every real submission is

1. **validated** server-side — email format + disposable-domain block, website/handle sanity,
   hidden honeypot field, 4 submissions per IP per minute;
2. **stored** — Cloudflare KV (binding `LEADS`, the durable copy) **and** Airtable
   (table *Leads* in the lead-gen base, `Source = "Free audit form — website"`, `Status = New`)
   so inbound requests land in the same place as the cold-outreach pipeline;
3. **emailed** — a notification to `hello@hkexposurelab.com` via Resend, with `reply_to` set to
   the prospect, so replying answers them directly.

The browser only shows “Audit on its way.” when at least one store (or the email) succeeded;
otherwise it offers `hello@hkexposurelab.com` as a fallback. Bots that fill the honeypot get a
silent 200 and nothing is stored.

### Required configuration (Cloudflare Pages → Settings → Variables and Secrets, Production)

| Name | Type | Notes |
| --- | --- | --- |
| `LEADS` | KV namespace binding | Durable copy + rate limiting. |
| `AIRTABLE_API_KEY` | Secret | PAT with `data.records:write` on the base. |
| `AIRTABLE_BASE_ID` | Variable | `app…` |
| `AIRTABLE_TABLE_NAME` | Variable | `Leads` |
| `RESEND_API_KEY` | Secret | Sends the notification email. |
| `AUDIT_TO` | Variable | Default `hello@hkexposurelab.com`. |
| `AUDIT_FROM` | Variable | Default `Exposure Lab <audit@hkexposurelab.com>` — must be a Resend-verified sender. |
| `ADMIN_TOKEN` | Secret | Any long random string; needed to read leads back out (below). |

### Read the captured leads back

```bash
curl -s "https://hkexposurelab.com/api/audit?token=$ADMIN_TOKEN"                 # JSON
curl -s "https://hkexposurelab.com/api/audit?token=$ADMIN_TOKEN&format=csv" -o leads.csv
```

Without a correct token the endpoint returns 404.

## Local development

```bash
npm i --prefix .cf-dev                     # wrangler, dev-only (gitignored)
# .dev.vars (gitignored) holds ADMIN_TOKEN + AIRTABLE_* for local runs
node C:/hermesworkspace/.cf-dev/node_modules/wrangler/bin/wrangler.js \
  pages dev C:/hermesworkspace --port 8788 --kv LEADS
```

Tests (real Airtable writes, cleaned up afterwards):

```bash
cd hk-leadgen && set -a && . ./.env && set +a
cd ../.cf-dev && node test_intake.mjs      # validation, honeypot, storage, rate limit, export
```
