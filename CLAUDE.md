# LGM Dashboard — Claude Code Guide

## Project overview

Internal dashboard for **Little Giant Marketing**. Two tabs in a single React + Vite app:

- **Quality Control** — call scoring, frustrated-call tracking, employee performance
- **Customer Health** — account health scoring, at-risk / upsell detection, MRR tracking

Deployed to **Vercel** via auto-deploy from `main` on GitHub:
`https://github.com/syedmhamza005-code/lgm-dashboard.git`

---

## Stack

| Layer | Tool |
|---|---|
| Framework | React 18 + Vite |
| Styling | Tailwind CSS v3 (custom brand tokens) |
| Charts | Recharts |
| Date math | date-fns v3 |
| Icons | lucide-react |
| Data | Google Sheets CSV (client-side polling, no backend) |

---

## Running locally

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"   # npm lives here
npm run dev      # dev server → http://localhost:5173
npm run build    # production build → dist/
```

> The `npm` binary is under nvm, not in the default shell PATH. Always export the PATH above before running npm commands in this project.

---

## Brand tokens (Tailwind)

Use `brand-*` classes — never hardcode hex values in JSX unless passing to inline `style={}`.

| Token | Hex | Usage |
|---|---|---|
| `brand-bg` | `#F4F6F4` | Page / card backgrounds |
| `brand-border` | `#E5E7E5` | All borders |
| `brand-green` | `#8CC63F` | Primary accent, active states, CTAs |
| `brand-red` | `#EF4444` | Errors, at-risk, frustrated calls |
| `brand-yellow` | `#EAB308` | Warnings, Watch band |
| `brand-heading` | `#4A4A4A` | Headings |
| `brand-muted` | `#6B7280` | Secondary text, labels |
| `brand-text` | `#1A1A1A` | Body text |

---

## Data sources

### Quality Control sheet
Parsed by `src/hooks/useGoogleSheets.js`. Columns: date, time, employee, customer, score, category, frustrated (bool), duration, summary.

### Customer Health sheet
CSV URL:
```
https://docs.google.com/spreadsheets/d/e/2PACX-1vTmb8CwnD8LgR_TzLwjz2Qy1yMUz_yQqAKiOHmcQtldCuHcZs8jeHwW2zvHIXDOODtrk0c_ZxnJ6Dqq/pub?output=csv
```
Parsed by `src/hooks/useHealthSheet.js`. Uses `HEADER_PATTERNS` regex array for flexible column detection (handles variations like "Users (Adjusted)" vs "Users").

Both hooks: 60 s polling, 3 retries with 10 s backoff, cache-bust via timestamp query param.

---

## Health scoring (`src/lib/`)

### `healthConfig.js` — single source of truth for all thresholds
```js
CHURN_TXN_THRESHOLD = 3500   // below this → at-risk
UPSELL_MIN_USERS    = 3      // above this (+ txns > 3500) → upsell ready
HEALTH_BANDS        = { healthy: 80, watch: 50 }
WEIGHTS             = { transactions: 0.40, users: 0.20, revenue: 0.15, tenure: 0.15, activity: 0.10 }
```

### `healthEngine.js` — pure scoring functions, no side effects
- `scoreAccount(account, { maxRev })` — revenue score scales to dataset max, not hardcoded
- `classify(score)` → `'healthy' | 'watch' | 'at_risk'`
- `isAtRisk(account)` — `transactions < 3500 OR score < 50`
- `isUpsellReady(account)` — `transactions > 3500 AND users > 3`
- `suggestAddon(account)` — rule-based add-on recommendation with `estExtra` $/mo
- `recommendAction(account)` — plain-language next action string
- If `lastActivity` is missing, its 10% weight is redistributed proportionally

**Never change thresholds inline** — always edit `healthConfig.js`.

---

## State architecture

### Tab state
`activeTab` lives in `App.jsx`, persisted to `localStorage` key `lgm-active-tab`.

### Filter state
- **QC tab**: `filter` + `categoryFilter` — local to `App.jsx`, apply to call data only
- **Health tab**: `healthFilters` — also in `App.jsx`, passed as `filters` / `setFilters` props to `<HealthDashboard>`. Lives in App so it persists when switching tabs.

`healthFilters` shape:
```js
{ search: '', typeFilter: 'all', bandFilter: 'all', dateRange: { type: 'all', from: '', to: '' } }
```
Date range types: `'all' | 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'custom'`. Filters on `stripeStartDate`.

### localStorage keys
| Key | Purpose |
|---|---|
| `lgm-active-tab` | Last active tab |
| `lgm-call-statuses` | QC at-risk call 3-state status |
| `lgm-account-statuses` | Health at-risk account 3-state status |
| `lgm-upsell-contacted` | Upsell contacted toggle + timestamp |

---

## File map

```
src/
  App.jsx                          — root: tab state, QC filter state, healthFilters state
  lib/
    healthConfig.js                — all thresholds & weights (edit here, not inline)
    healthEngine.js                — pure scoring functions
  hooks/
    useGoogleSheets.js             — QC sheet polling
    useHealthSheet.js              — Health sheet polling
    useCallStatus.js               — localStorage for call statuses
    useAccountStatus.js            — localStorage for account statuses
    useCountUp.js                  — animated number counter
  components/
    Header.jsx                     — QC tab header with date filter + category filter
    TabSwitcher.jsx                — two-tab switcher (qc / health)
    SummaryCards.jsx               — QC summary (total/positive/frustrated)
    QuickStats.jsx                 — QC avg score, duration, response rate
    TopPerformer.jsx               — highest avg score employee card
    EmployeeTable.jsx              — sortable employee stats table
    MeetingsChart.jsx              — Recharts line/bar chart
    ResolutionTracker.jsx          — QC at-risk call progress tracker
    FrustratedTable.jsx            — frustrated calls table with status actions
    TeamInsights.jsx               — trend insights panel
    ActivityFeed.jsx               — live recent calls feed
    EmployeeModal.jsx              — employee detail modal
    AgencyCard.jsx                 — agency popover card
    health/
      HealthDashboard.jsx          — Health tab root: filteredAccounts drives everything
      HealthFilterBar.jsx          — search + type + band + date range filters
      HealthSummaryCards.jsx       — 6 KPI cards (accounts, MRR, at-risk, healthy, upsell, avg sub)
      DmAgentBreakdown.jsx         — DM vs Agent pie + stats
      ResolutionTrackerHealth.jsx  — at-risk account progress tracker
      NeedsAttentionTable.jsx      — at-risk accounts, sorted worst-first
      UpsellTable.jsx              — upsell-ready accounts, sorted by est. MRR
      MasterAccountsTable.jsx      — all accounts, sortable, paginated (25/page)
      HealthCharts.jsx             — 3 charts: distribution, rev by band, txn histogram
      QuickWins.jsx                — top 3 upsell + top 3 at-risk quick view
      AccountModal.jsx             — account detail modal with score breakdown
```

---

## Key patterns

### Adding a new component
Follow the existing card pattern: `animate-fade-in-up rounded-2xl border border-brand-border bg-white` with `boxShadow: '0 1px 4px rgba(0,0,0,0.06)'`.

### Modals
Use `fixed inset-0 z-[100]`, backdrop `bg-black/40 backdrop-blur-sm`, lock body scroll with `document.body.style.overflow = 'hidden'` in a `useEffect`. See `AccountModal.jsx` or `EmployeeModal.jsx`.

### Tables with status actions
Pattern from `FrustratedTable.jsx` / `NeedsAttentionTable.jsx`: left-colored border on rows, 3-state status (open → in-progress → resolved), action buttons column.

### Charts (Recharts)
All charts use responsive containers. Health band colors always come from `healthConfig.js` `COLORS`. The chunk-size warning (`>500 kB`) on build is expected from Recharts — not an error.

---

## Deploy

```bash
git add <files>
git commit -m "your message"
git push origin main        # Vercel auto-deploys on push to main
```

Build check before pushing: `npm run build` — must exit with `✓ built` and no errors.

---

## Daily AI Briefings (internal emails)

Weekday morning emails per role (Joe / Kevin / Rachel / inbound team / John), generated on the
Customer Health Vercel project by `api/cron-daily-briefing.js`. All numbers are computed in
`api/_briefingCollect.js`; Claude only picks and explains (`api/_briefingAnalyze.js`).
Preview any role without sending: `GET /api/briefing?role=kevin&key=<BRIEFING_PREVIEW_KEY>`.
Full guide: `docs/daily-briefings.md`. Any new cron in `vercel.json` must gate on `VITE_APP_MODE`
inside its handler — the file is shared by every Vercel project built from this repo.
