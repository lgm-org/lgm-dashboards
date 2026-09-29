# Daily AI Briefings (internal)

Role-specific morning emails ("what happened, what matters, what should I do today") generated
from the data the dashboards already have. Spec: John's "Daily Briefings Upgrades (Internal)"
ClickUp task, 2026-09-29.

Runs on the **Customer Health** Vercel project (`lgm-customer-health`, `VITE_APP_MODE=health`),
because that project already holds every secret the job needs.

## How it works

```
cron-health-sync (weekdays 09:00–10:50 UTC, every 10 min, resumable cursor)
   └─ refreshes ghl_account_stats + health_score_daily for all ~330 sub-accounts

cron-daily-briefing (weekdays 11:15 UTC = 06:15 Central)
   1. _briefingCollect.buildContext  → loads GHL accounts, Stripe, Supabase health tables,
                                        dm_agent_map, the Team AI meeting sheet, LGM inbound
                                        calls (GHL), Freshdesk — all in parallel, each optional
   2. collect<Role>                  → deterministic fact pack per role (every number is computed here)
   3. _briefingAnalyze.analyze       → ONE Claude call per role (structured output, refs validated)
   4. _briefingRender.render         → HTML: wins → actions → priorities → role sections → raw tables
   5. _briefingRun.sendEmail         → Resend; result logged in briefing_sends
   6. snapshots                      → briefing_snapshots (per role + `_stripe` for expansion/churn),
                                        briefing_items (no-repeat rule: 3 days unless changed ≥5 pts or score < 30)
```

Roles: `joe` (DM growth) · `kevin` (sales + follow-up) · `rachel` (onboarding + retention hit list) ·
`inbound` (Hope/Jessica/Kylie/Rachel) · `john` (CEO roll-up, built from the other four packs).

## Preview / manual runs

`/api/briefing` — auth with `?key=<BRIEFING_PREVIEW_KEY>` (or `CRON_SECRET`).

| Call | Result |
|---|---|
| `GET /api/briefing?role=kevin&key=…` | The email as HTML, nothing sent or stored |
| `GET /api/briefing?role=john&format=json&key=…` | Fact pack + AI analysis |
| `GET /api/briefing?role=rachel&skipAi=1&key=…` | Raw-data-only render, no Claude call |
| `POST /api/briefing?role=joe&send=1&to=me@x.com&key=…` | Send one role to an override address |
| `POST /api/briefing?send=1&key=…` | Send all roles to configured recipients |
| `…&runDay=2026-09-26` | Run as if it were that morning |

## Environment variables (lgm-customer-health)

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | already set (Jarvis) |
| `RESEND_API_KEY` | **needed to send** — Resend account with `littlegiantmarketing.com` verified |
| `BRIEFING_FROM` | e.g. `LGM Briefings <briefings@littlegiantmarketing.com>` |
| `BRIEFING_RECIPIENTS` | JSON: `{"joe":["joe@…"],"kevin":["…"],"rachel":["…"],"inbound":["hope@…","jessica@…","kylie@…","rachel@…"],"john":["john@…"]}` |
| `BRIEFING_TEST_TO` | While set, **every** briefing goes only here (safe rollout). Remove to go live. |
| `BRIEFING_PREVIEW_KEY` | Key for the preview endpoint |
| `BRIEFING_MODEL` | Optional; default `claude-opus-5` |
| `BRIEFINGS_ENABLED` | Set `0` to pause the cron |
| `BRIEFING_DASHBOARD_URL` | Optional; default `https://health.littlegiantmarketing.com` |

Deep links: every account in an email links to `health.littlegiantmarketing.com/?account=<locationId>`,
which opens that account's modal (HealthDashboard.jsx).

## Data gaps (sections show "no data" until filled)

- **DM → agent mapping** (`dm_agent_map`) is empty → Joe's briefing and John's DM section are placeholders until the n8n DM sync populates it.
- **Per-rep sales attribution** is not recorded → Kevin's sales table is company-wide.
- **Time to answer** for inbound calls is not in GHL call messages → shown as "—" until the n8n call tracker stores ring timestamps.
- **Expansion / churned MRR** needs a previous-day `_stripe` snapshot → appears from the second run.
- Health scores refresh via `cron-health-sync`; accounts with `sync_note` (paused/deleted in GHL) have no score.

## Files

```
api/_briefingSources.js   loaders + date helpers + briefing tables
api/_briefingCollect.js   buildContext + collectRachel/Kevin/Joe/Inbound/John
api/_briefingAnalyze.js   Claude call (SDK, zod structured output, ref validation)
api/_briefingRender.js    HTML email
api/_briefingRun.js       orchestration + Resend
api/cron-daily-briefing.js, api/cron-health-sync.js, api/briefing.js
src/lib/stripeOverrides.js  MANUAL_LOC_TO_CUST shared by client + server
```
Refactors: `ghl-accounts.js` exports `fetchGhlAccounts`, `stripe-billing.js` exports `buildStripeBilling`,
`ghl-sync-activity-batch.js` exports `runSync`. Handlers unchanged in behaviour.
