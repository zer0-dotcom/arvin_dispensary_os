# Arvin Dispensary OS

Internal, **read-only** tooling for a NYC dispensary operator running two retail
locations on Dutchie POS. Source code only — you run it on your own
infrastructure. Nothing here deploys or sends anything outbound.

## What's inside

| Path | Purpose |
| --- | --- |
| `lib/alerts/` | Tiered alert system (`TIER_1/2/3`). `TIER_3` **halts + surfaces only** — never auto-acts. |
| `lib/vault/secrets.ts` | Loads Dutchie credentials from **AWS Secrets Manager** (`prod/dispensary-os/dutchie`), falling back to `process.env` for local dev. Never hardcodes secrets. |
| `lib/dutchie/client.ts` | **Read-only** Dutchie POS client for both nodes (`NODE_5TH_AVE`, `NODE_9TH_AVE`). GET-only; no mutation methods. |
| `modules/competitor-radar/scraper.ts` | Scrapes 5 **public** Dutchie storefront menus using `Promise.allSettled`. |
| `modules/competitor-radar/persistence.ts` | Persists sweep results as JSON (before any summary). |
| `modules/competitor-radar/scheduler.ts` | `node-cron` scheduler for periodic sweeps. |
| `scripts/verify-nodes.ts` | Auth-check both store nodes (read-only), per-node pass/fail. |
| `scripts/run-competitor-sweep.ts` | Run one sweep end-to-end, persist + print summary. |
| `frontend/` | Next.js 14 (App Router) **read-only** intelligence console. Deployed on Railway with build root = `frontend/`. |
| `frontend/lib/pipeline/` | **Self-contained** dossier-refresh pipeline (margin scanner, demand forecaster, vendor scorecards, dossier synthesizer). Byte-compatible with the repo-root `modules/` ports, but with zero cross-dir runtime deps so it works on Railway. |
| `frontend/app/api/cron/dossier/route.ts` | `CRON_SECRET`-protected route that pulls fresh Dutchie catalogs and writes a new weekly dossier + margin scan to `frontend/data/`. |
| `frontend/app/api/chat/route.ts` + `frontend/components/MikCopilot.tsx` | "MiK" floating conversational copilot — answers NL questions about inventory, margins, dead/overstock, grounded in the latest dossier JSON. |

## Frontend (Next.js console)

The `frontend/` app is deployed on Railway with its **build/deploy root set to
`frontend/` only**. Because of that, the deployed service cannot read the
repo-root `modules/`, `lib/`, or `scripts/` directories at runtime
(`experimental.externalDir` covers local dev only). Two consequences:

1. **The dossier pipeline is ported, self-contained, under `frontend/lib/pipeline/`.**
   Rather than importing the repo-root `modules/`, the refresh route depends
   only on files inside `frontend/`. The ports are byte-compatible with the
   originals so dossier JSON stays interchangeable.
2. **Dutchie creds come from env vars, not AWS Secrets Manager.** The frontend
   deliberately avoids pulling the AWS SDK; `frontend/lib/pipeline/dutchie-client.ts`
   reads `DUTCHIE_API_KEY_5TH_AVE` / `DUTCHIE_API_KEY_9TH_AVE` /
   `DUTCHIE_API_BASE_URL` directly from `process.env`.

See `frontend/.env.example` for all frontend env vars.

### Refreshing the dossier (protected cron route)

`GET` or `POST` `/api/cron/dossier`, authenticated with `CRON_SECRET`:

```bash
# either header works
curl -X POST https://<app>/api/cron/dossier \
  -H "Authorization: Bearer $CRON_SECRET"

curl -X POST https://<app>/api/cron/dossier \
  -H "x-cron-secret: $CRON_SECRET"
```

- Fails **closed** (HTTP 500) if `CRON_SECRET` is not configured.
- Returns **401** on a missing/mismatched secret (constant-time compare).
- On success, pulls both nodes' catalogs (`Promise.allSettled`), runs the
  margin scanner / forecaster / scorecards, synthesizes a dossier, and writes
  fresh JSON to `frontend/data/forward-intel/` and `frontend/data/margin-scans/`
  (best-effort mirror to the repo-root `data/` too). Point a Railway cron job at
  this route to schedule refreshes.

### MiK conversational copilot

A floating chat button (bottom-right, on every page) opens the "MiK" copilot.
It answers natural-language questions about inventory health, margins, dead
stock, and overstock — grounded in the latest dossier / margin-scan JSON via
`POST /api/chat`. With `LLM_API_KEY` (or `ABACUS_API_KEY`) set it uses an
OpenAI-compatible LLM; without a key it degrades gracefully to a deterministic,
data-grounded fallback answer. It is **read-only** — it never triggers actions.

## Setup

```bash
npm install
cp .env.example .env   # local dev only — placeholders, never real keys
```

In production, credentials come from AWS Secrets Manager at
`prod/dispensary-os/dutchie` (a JSON blob with `apiKey5thAve`, `apiKey9thAve`,
optional `apiBaseUrl`). If AWS is unreachable, the loader falls back to the env
vars documented in `.env.example`.

## Commands

```bash
npm run typecheck        # strict-mode type check (zero errors)
npm run build            # compile to dist/
npm run verify-nodes     # read-only auth check for both nodes
npm run competitor-sweep # one competitor sweep -> data/competitor-sweeps/*.json
npm run schedule         # start the recurring sweep scheduler
```

## Hard safety rules (enforced in code)

1. No hardcoded secrets — ever.
2. Dutchie access is **read-only** — no write/mutation methods exist.
3. `TIER_3` alerts halt processing and surface for a human; no auto-remediation.
4. Every external API / network call is wrapped through the alert system.
5. All multi-node / multi-target work uses `Promise.allSettled`.
6. Sweep results are persisted to disk **before** any summary is produced.
7. No financial, marketing, or automated-send actions anywhere.
