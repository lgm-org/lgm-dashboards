# Daily AI Briefings (internal)

Role-specific morning emails ("what happened, what matters, what should I do today") generated
from the data the dashboards already have. Sent every Monday to Friday at 06:15 Central:
Tuesday-Friday cover yesterday, the Monday edition covers the whole previous week (Mon-Sun). Spec: John's "Daily Briefings Upgrades (Internal)"
ClickUp task, 2026-09-29.

Runs on the **Customer Health** Vercel project (`lgm-customer-health`, `VITE_APP_MODE=health`),
because that project already holds every secret the job needs.

## How it works

```
cron-health-sync (weekdays 09:00–10:50 UTC, every 10 min, resumable cursor)
   └─ refreshes ghl_account_stats + health_score_daily for all ~330 sub-accounts

cron-daily-briefing (Mon-Fri 11:15 UTC = 06:15 Central; Monday = week recap)
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

Roles: `joe` (DM growth) · `kevin` (sales + follow-up + upsell opportunities) · `rachel` (onboarding + retention hit list + new-client age cohorts) ·
`inbound` (**Client Coordinators Briefing** — Hope/Jessica/Kylie/Rachel: inbound calls + new-client age cohorts) · `john` (CEO roll-up).

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
| `GMAIL_USER` + `GMAIL_APP_PASSWORD` | Google Workspace SMTP sender (app password); wins over Resend when set |
| `BRIEFING_RECIPIENTS` | JSON: `{"joe":["joe@…"],"kevin":["…"],"rachel":["…"],"inbound":["hope@…","jessica@…","kylie@…","rachel@…"],"john":["john@…"]}` |
| `BRIEFING_TEST_TO` | While set, **every** briefing goes only here (safe rollout). Remove to go live. |
| `BRIEFING_PREVIEW_KEY` | Key for the preview endpoint |
| `BRIEFING_MODEL` | Optional; default `claude-opus-5` |
| `BRIEFINGS_ENABLED` | Set `0` to pause the cron |
| `BRIEFING_DASHBOARD_URL` | Optional; default `https://health.littlegiantmarketing.com` |

Deep links: every account in an email links to `health.littlegiantmarketing.com/?account=<locationId>`,
which opens that account's modal (HealthDashboard.jsx).

## Sales source

Sales and New MRR = opportunities with status **Won** in LGM's GHL Sales Pipeline (the pipeline containing the
"Payment Made / Account Build" stage); New MRR = the opportunity's monetary value (per John, 2026-10-01).
Opportunities map to client accounts via the LGM customer record's "Sub-account ID", then contact email, then name.
If the GHL pull fails the run falls back to Stripe subscription starts and says so in the email. Active MRR per
account and expansion/churn still come from Stripe.

## Upsell rule (John, 2026-10-05)

Dashboard and Sales briefing share `upsellTier()` in `src/lib/healthEngine.js`: 300+ calls in the past 7 days
(`ghl_account_stats.calls_7d`) AND no add-ons → **Upsell**; AND exactly one add-on → **High priority**.
Add-ons are detected from Stripe price nicknames (`addOnFlags()` in `api/stripe-billing.js`): LeadFlow AI ($50/mo),
AI Call Coach ($50/user/mo). **Unflag** in the dashboard (`/api/upsell-flags`, table `upsell_dismissals`) hides the
account from both for 30 days (`UPSELL_DISMISS_DAYS`), after which it qualifies again automatically.

## New-client cohorts (John, 2026-10-05)

Client Coordinators and Client Relations briefings group new clients by account age: 5–9, 10–15, 16–30, 31–60 days,
with count, average health and the account list (`newClientCohorts()` in `_briefingCollect.js`).

## Data gaps (sections show "no data" until filled)

- **DM → agent mapping** (`dm_agent_map`) is empty → Joe's briefing and John's DM section are placeholders until the n8n DM sync populates it.
- **Per-rep sales attribution** comes from the LGM sub-account customer contact field "New Customer Signed Up By" (Kevin / Joe), matched to the client via "Sub-account ID"; sales without it show as Unattributed. The same record supplies onboarding status (Account Build Out, Team Onboarding Training Date, A2P Approved Date, User Subscription Status).
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
