import InfoTip from './InfoTip'

const G = '#8CC63F'

const DATE_OPTIONS = [
  { label: 'All Dates',    value: 'all'        },
  { label: 'Today',        value: 'today'      },
  { label: 'Yesterday',    value: 'yesterday'  },
  { label: 'Last 7 Days',  value: 'last_7'     },
  { label: 'This Month',   value: 'this_month' },
  { label: 'Last Month',   value: 'last_month' },
  { label: 'Last 30 Days', value: 'last_30'    },
  { label: 'Last 90 Days', value: 'last_90'    },
  { label: 'Custom',       value: 'custom'     },
]

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

const EMPTY = { search: '', typeFilter: 'all', dmFilter: 'all', bandFilter: 'all', billingFilter: 'all', dateRange: { type: 'all', from: '', to: '' } }

export default function HealthFilterBar({ filters, setFilters, totalShowing, totalAll, dmManagedCount = 0, directCount = 0, dmList = [] }) {
  const { search, typeFilter, dmFilter = 'all', bandFilter, billingFilter = 'all', dateRange } = filters

  const set    = (patch) => setFilters(f => ({ ...f, ...patch }))
  const setDR  = (patch) => setFilters(f => ({ ...f, dateRange: { ...f.dateRange, ...patch } }))
  const isDirty = search || typeFilter !== 'all' || dmFilter !== 'all' || bandFilter !== 'all' || billingFilter !== 'all' || dateRange.type !== 'all'

  return (
    <div
      className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}
    >
      <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-2 sm:gap-3">

        {/* Search */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <input
            type="text"
            placeholder="Search accounts…"
            value={search}
            onChange={e => set({ search: e.target.value })}
            className="text-[12px] border border-brand-border rounded-lg px-3 py-1.5 bg-brand-bg focus:outline-none focus:border-brand-green w-[165px]"
          />
          <InfoTip
            text="Search by account name. Case-insensitive partial match — type any part of the name to filter."
            position="bottom-end"
          />
        </div>

        {/* DM Footprint filters — same classification as the DM Footprint tab */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <select
            value={typeFilter}
            onChange={e => set({ typeFilter: e.target.value, ...(e.target.value === 'direct' ? { dmFilter: 'all' } : {}) })}
            className="text-[11px] font-semibold border border-brand-border rounded-lg px-2.5 py-1.5 bg-brand-bg focus:outline-none cursor-pointer transition-colors duration-150"
            style={{
              color:       typeFilter !== 'all' ? '#3a6b10' : '#6B7280',
              background:  typeFilter !== 'all' ? `${G}10`  : '#F4F6F4',
              borderColor: typeFilter !== 'all' ? `${G}50`  : '#E5E7E5',
            }}
          >
            <option value="all">All accounts{dmManagedCount + directCount > 0 ? ` (${dmManagedCount + directCount})` : ''}</option>
            <option value="dm_managed">Under a DM{dmManagedCount > 0 ? ` (${dmManagedCount})` : ''}</option>
            <option value="direct">Not in DM Footprint{directCount > 0 ? ` (${directCount})` : ''}</option>
          </select>
          <InfoTip
            text={"Same rule as the DM Footprint tab.\nUnder a DM = the sub-account is listed in the DM Footprint (Supabase dm_agent_map, filled hourly by n8n from the GHL contact custom field that assigns an agent to a District Manager).\nNot in DM Footprint = no DM assigned (direct / independent account).\nPick a specific DM in the next dropdown to see only that DM's agents."}
            position="bottom-end"
          />
        </div>

        {/* Specific DM */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <select
            value={dmFilter}
            onChange={e => set({ dmFilter: e.target.value, ...(e.target.value !== 'all' ? { typeFilter: 'dm_managed' } : {}) })}
            className="text-[11px] font-semibold border border-brand-border rounded-lg px-2.5 py-1.5 bg-brand-bg focus:outline-none cursor-pointer transition-colors duration-150 max-w-[190px]"
            style={{
              color:       dmFilter !== 'all' ? '#3a6b10' : '#6B7280',
              background:  dmFilter !== 'all' ? `${G}10`  : '#F4F6F4',
              borderColor: dmFilter !== 'all' ? `${G}50`  : '#E5E7E5',
            }}
          >
            <option value="all">All DMs{dmList.length ? ` (${dmList.length})` : ''}</option>
            {dmList.map(d => (
              <option key={d.name} value={d.name}>{d.name} ({d.count})</option>
            ))}
          </select>
          <InfoTip
            text={"Filter to one District Manager's agents — the same grouping as the DM Footprint tab. The number is how many agent sub-accounts are assigned to that DM."}
            position="bottom-end"
          />
        </div>

        {/* Band filter */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <select
            value={bandFilter}
            onChange={e => set({ bandFilter: e.target.value })}
            className="text-[11px] font-semibold border border-brand-border rounded-lg px-2.5 py-1.5 bg-brand-bg focus:outline-none cursor-pointer transition-colors duration-150"
            style={{
              color:       bandFilter !== 'all' ? '#3a6b10' : '#6B7280',
              background:  bandFilter !== 'all' ? `${G}10`  : '#F4F6F4',
              borderColor: bandFilter !== 'all' ? `${G}50`  : '#E5E7E5',
            }}
          >
            <option value="all">All Accounts</option>
            <option value="healthy">Healthy — score 70+</option>
            <option value="watch">Watch — score 55–69</option>
            <option value="at_risk">At Risk — score below 55</option>
            <option value="no_data">No GHL data</option>
          </select>
          <InfoTip
            text={"Filter by 100-point health score band.\nPlatform Activity 45 (7-day calls + last call) · Sales Activity 40 (last sale + sales in 30 days) · Account Health 15 (support tickets in 7 days).\nNo GHL data = GHL returned nothing for the sub-account (paused / not active)."}
            position="bottom-end"
          />
        </div>

        {/* Billing / Stripe filter */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <select
            value={billingFilter}
            onChange={e => set({ billingFilter: e.target.value })}
            className="text-[11px] font-semibold border border-brand-border rounded-lg px-2.5 py-1.5 bg-brand-bg focus:outline-none cursor-pointer transition-colors duration-150"
            style={{
              color:       billingFilter !== 'all' ? '#7c3aed' : '#6B7280',
              background:  billingFilter !== 'all' ? '#7c3aed10' : '#F4F6F4',
              borderColor: billingFilter !== 'all' ? '#7c3aed50' : '#E5E7E5',
            }}
          >
            <option value="all">All Billing</option>
            <option value="matched">Stripe Matched</option>
            <option value="unmatched">Unmatched (no Stripe)</option>
            <option value="past_due_or_open">Past Due or Open Invoice</option>
            <option value="canceling">Subscription Canceling</option>
            <option value="paused_stripe">Billing Paused (Stripe)</option>
            <option value="paused_ghl">Account Paused (GHL)</option>
            <option value="paused_both">Both Paused</option>
          </select>
          <InfoTip
            text="Filter by Stripe billing match. 'Unmatched' shows accounts not yet linked to a Stripe customer — coordinate with Cliff to resolve these via his mapping sheet."
            position="bottom-end"
          />
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-brand-border flex-shrink-0 hidden sm:block" />

        {/* Date range label + pills */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] font-bold text-brand-muted uppercase tracking-wider whitespace-nowrap hidden sm:inline">Customer Since</span>
          <InfoTip
            text="Filters accounts by their join date — when the GHL sub-account was created for this client (pulled automatically from GoHighLevel). If the billing sheet has a Stripe Start Date, that is used instead. 'Last 7 Days' = accounts whose sub-account was created in the past 7 days. 'This Month' = created this calendar month. Use 'All Dates' to see the full portfolio."
            position="bottom-end"
          />
        </div>

        <div className="flex items-center gap-0.5 bg-brand-bg border border-brand-border rounded-lg p-0.5 flex-shrink-0 overflow-x-auto">
          {DATE_OPTIONS.map(opt => {
            const active = dateRange.type === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setDR({ type: opt.value })}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all duration-200 flex-shrink-0 ${
                  active ? 'text-white btn-green-active' : 'text-brand-muted hover:text-brand-text hover:bg-white'
                }`}
                style={active ? { background: G } : {}}
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        {/* Result count + Reset */}
        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {isDirty && (
            <span className="text-[11px] text-brand-muted">
              <span className="font-semibold text-brand-text">{totalShowing}</span> of {totalAll} accounts
            </span>
          )}
          {isDirty && (
            <button
              onClick={() => setFilters(EMPTY)}
              className="text-[11px] font-semibold text-brand-muted hover:text-brand-text border border-brand-border rounded-lg px-2.5 py-1.5 bg-brand-bg transition-colors flex-shrink-0"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Custom date row */}
      {dateRange.type === 'custom' && (
        <div className="border-t border-brand-border/50 px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-brand-muted text-[11px] font-semibold flex-shrink-0">GHL sub-account created between:</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <label className="text-brand-muted text-[11px]">From</label>
            <input
              type="date"
              value={dateRange.from}
              max={dateRange.to || todayStr()}
              onChange={e => setDR({ from: e.target.value })}
              className="text-[12px] text-brand-text border border-brand-border rounded-lg px-2.5 py-1 bg-brand-bg focus:outline-none focus:border-brand-green w-[140px]"
            />
          </div>
          <span className="text-brand-muted text-[11px]">→</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <label className="text-brand-muted text-[11px]">To</label>
            <input
              type="date"
              value={dateRange.to}
              min={dateRange.from}
              onChange={e => setDR({ to: e.target.value })}
              className="text-[12px] text-brand-text border border-brand-border rounded-lg px-2.5 py-1 bg-brand-bg focus:outline-none focus:border-brand-green w-[140px]"
            />
          </div>
          {(!dateRange.from || !dateRange.to) && (
            <span className="text-amber-600 text-[11px]">Select both dates to filter</span>
          )}
        </div>
      )}
    </div>
  )
}
