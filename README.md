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
