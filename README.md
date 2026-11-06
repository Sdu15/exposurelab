# hkexposurelab.com

Static marketing site for **Exposure Lab** (Hong Kong funnel-diagnosis agency).

* Live: <https://hkexposurelab.com> — Cloudflare Pages, project `exposurelabhk`, deployed
  **from the root of this repo** on every push to `main`.
* No build step: plain HTML + one shared CSS file, two small JS files, and Cloudflare
  Pages Functions for the audit intake endpoint.
* **This repo is public.** `.gitignore` is deny-by-default: only files the site serves
  (and `functions/`) are tracked. Never `git add .` — check `git status` first.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | Landing page. Offer ladder, four pillars, numbered reasons, metrics, process, deliverables, founders, pricing table, FAQ. The free-audit form sits in the hero (`#free-audit`). |
| `free-audit.html` | The free-audit request page (form first). Served at `/free-audit`. |
| `detailed-audit.html` | The HK$3,000 detailed-audit page. Served at `/detailed-audit`. |
| `privacy.html`, `terms.html` | Privacy policy and terms. Served at `/privacy`, `/terms` (both are linked from every footer). |
| `404.html` | Served by Pages for unknown paths. |
| `site.css` | **All** styling — one file, cached across pages. Palette and layout follow the two reference sites studied (acquisition.com's navy canvas + single electric accent + gold figures; firstpage.hk's inline hero form, mono eyebrows, numbered "why us", 4-step process). |
| `site.js` | FAQ accordion, mobile nav, sticky-header state, reveal-on-scroll. Every section works without JS. |
| `audit-form.js` | Client-side validation + `POST /api/audit` + success/error states. Selector-tolerant (accepts both `#form-success`/`#email-error` and the older `#audit-done`/`.lf-err[data-for]` markup). |
| `functions/api/audit.js` | The intake endpoint. See below. |
| `favicon.svg`, `og-image.png` | Icon + social preview card (both referenced from every page). |
| `robots.txt` | Allows crawlers **including AI/answer engines** (GPTBot, OAI-SearchBot, ClaudeBot, anthropic-ai, PerplexityBot, Google-Extended, Applebot, CCBot…). Disallows `/api/`. |
| `sitemap.xml`, `llms.txt` | Crawler files. `llms.txt` is a structured brief (offer ladder, prices, straight answers) written to be quoted by an assistant. |

**Clean URLs:** Pages 308-redirects `*.html`, so canonicals, sitemap entries, `llms.txt`
and internal links all use the extensionless URL (`/free-audit`, `/detailed-audit`).

## The free-audit form (leads)

`POST /api/audit` is the only moving part. Every real submission is

1. **validated** server-side — email format + disposable-domain block, website/handle
   sanity, hidden honeypot field, 4 submissions per IP per minute;
2. **stored** — Cloudflare KV (binding `LEADS`, the durable copy) **and** Airtable
   (table *Leads*, `Source = "Free audit form — website"`, `Status = New`) so inbound
   requests land where the cold-outreach pipeline already reads from;
3. **emailed** — notification to `hello@hkexposurelab.com` via Resend, with `reply_to`
   set to the prospect, so replying answers them directly.

The page only shows "Audit on its way." when at least one store (or the email) succeeded;
otherwise it shows a status line pointing at `hello@hkexposurelab.com`. Bots that fill the
honeypot get a silent 200 and nothing is stored.

### Required configuration (Cloudflare Pages → Settings → Variables and Secrets, **Production**)

| Name | Type | Notes |
| --- | --- | --- |
| `LEADS` | KV namespace binding | Durable copy + rate limiting. |
| `AIRTABLE_API_KEY` | Secret | PAT with `data.records:write` on the base. |
| `AIRTABLE_BASE_ID` | Plain text | `app…` |
| `AIRTABLE_TABLE_NAME` | Plain text | `Leads` |
| `RESEND_API_KEY` | Secret | Sends the notification email. |
| `AUDIT_TO` | Plain text | Default `hello@hkexposurelab.com`. |
| `AUDIT_FROM` | Plain text | Default `Exposure Lab <audit@hkexposurelab.com>` — must be a Resend-verified sender. |
| `ADMIN_TOKEN` | Secret | Needed to read leads back out (below). |

**Gotcha:** a `PATCH` on the project can silently drop `plain_text` variables — always
`GET /accounts/<acct>/pages/projects/exposurelabhk` afterwards and confirm all eight
names are listed. A missing `AIRTABLE_BASE_ID`/`AIRTABLE_TABLE_NAME` shows up at runtime
as `"failed":["airtable:airtable_not_configured"]` while KV and email still succeed.

After changing variables, deploy again before testing: push an empty commit
(`git commit --allow-empty -m chore: redeploy`) — the function reads config per deployment.

### Read the captured leads back

```bash
curl -s "https://hkexposurelab.com/api/audit?token=$ADMIN_TOKEN"                 # JSON
curl -s "https://hkexposurelab.com/api/audit?token=$ADMIN_TOKEN&format=csv" -o leads.csv
```

Without a correct token the endpoint returns 404.

## Deploying

`git push origin main` — Pages rebuilds in ~1–2 minutes. The origin remote currently
carries a fine-grained PAT in `.git/config`; **rotate/revoke it when you're done with it**
(a token in a remote URL is a standing leak).

## Local development

Serve a **staging directory**, not the repo root: the root contains large media files and
`wrangler pages dev <root>` hangs scanning them.

```bash
mkdir -p .cf-dev/stage && for f in index.html free-audit.html detailed-audit.html \
  privacy.html terms.html 404.html audit-form.js site.js site.css robots.txt sitemap.xml \
  llms.txt audit-reminder.ics favicon.svg og-image.png; do cp "$f" .cf-dev/stage/; done
mkdir -p .cf-dev/stage/functions/api && cp functions/api/audit.js .cf-dev/stage/functions/api/
cp .dev.vars .cf-dev/stage/            # local-only secrets (gitignored)

cd .cf-dev/stage && node ../../.cf-dev/node_modules/wrangler/bin/wrangler.js \
  pages dev . --port 8788 --kv LEADS
```

Tests (against the local server, then the same probe against production):

```bash
cd .cf-dev && node test_intake.mjs                              # endpoint: validation, honeypot, storage, rate limit, export
cd .cf-dev && node probe2.mjs http://127.0.0.1:8788             # browser: form feedback, FAQ, mobile overflow, asset failures
cd .cf-dev && node probe2.mjs https://hkexposurelab.com         # the same checks on live
```

`probe2.mjs` submits two real test leads — delete them from KV afterwards (the Cloudflare
KV API) or leave them and note them as tests.
