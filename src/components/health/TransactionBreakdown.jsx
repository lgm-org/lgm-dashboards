import { useState } from 'react'
import InfoTip from './InfoTip'

const fmt = (n) => '$' + Math.round(n).toLocaleString()

const BILLING_ITEMS = [
  {
    key:   'planPrice',
    label: 'Base Plan Subscriptions',
    icon:  '📋',
    desc:  'Core plan price — the monthly subscription fee clients pay for their GHL SaaS plan.',
    field: 'planPrice',
  },
  {
    key:   'monthlyUserSub',
    label: 'User Seat Fees',
    icon:  '👥',
    desc:  'Monthly per-user charges above the included seat count.',
    field: 'monthlyUserSub',
  },
  {
    key:   'addOns',
    label: 'Add-On Charges',
    icon:  '➕',
    desc:  'Custom add-on products charged on top of the base plan.',
    field: 'addOns',
  },
  {
    key:   'lcWalletCharges',
    label: 'LC Platform Usage',
    icon:  '⚡',
    desc:  'LC wallet charges — what clients use in Conversation AI, SMS, email, phone, and other GHL-native platform features.',
    field: 'lcWalletCharges',
  },
]

function DrilldownPanel({ item, accounts, onClose }) {
  const rows = accounts
    .filter(a => (a[item.field] || 0) > 0)
    .sort((a, b) => (b[item.field] || 0) - (a[item.field] || 0))

  const total = rows.reduce((s, a) => s + (a[item.field] || 0), 0)

  return (
    <div className="mt-3 rounded-xl border border-brand-border bg-brand-bg overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between border-b border-brand-border bg-white">
        <div className="flex items-center gap-2">
          <span>{item.icon}</span>
          <span className="text-brand-heading font-semibold text-sm">{item.label}</span>
          <span className="text-brand-muted text-[11px]">— {rows.length} accounts · {fmt(total)}/mo</span>
        </div>
        <button onClick={onClose}
          className="text-brand-muted hover:text-brand-heading text-sm w-6 h-6 flex items-center justify-center rounded-lg hover:bg-brand-bg border border-brand-border">
          ✕
        </button>
      </div>
      <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-brand-bg border-b border-brand-border">
            <tr>
              <th className="px-4 py-2 text-left text-brand-muted font-semibold uppercase text-[10px] tracking-wider">Account</th>
              <th className="px-2 py-2 text-left text-brand-muted font-semibold uppercase text-[10px] tracking-wider hidden sm:table-cell">Type</th>
              <th className="px-4 py-2 text-right text-brand-muted font-semibold uppercase text-[10px] tracking-wider">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border bg-white">
            {rows.map((a, i) => (
              <tr key={a.id} className="hover:bg-brand-bg/60">
                <td className="px-4 py-2">
                  <span className="text-brand-muted text-[10px] mr-2">{i + 1}</span>
                  <span className="text-brand-heading font-medium">{a.accountName}</span>
                </td>
                <td className="px-2 py-2 hidden sm:table-cell">
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${
                    (a.accountType || '').toLowerCase() === 'dm'
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-purple-50 border-purple-200 text-purple-700'
                  }`}>{a.accountType || '—'}</span>
                </td>
                <td className="px-4 py-2 text-right num font-semibold text-brand-heading">{fmt(a[item.field])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function TransactionBreakdown({ accounts, stripeLoading = false }) {
  const [expanded, setExpanded] = useState(null)

  if (!accounts.length) return (
    <div className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}>
      <div className="px-5 sm:px-6 py-4 border-b border-brand-border flex items-start justify-between gap-3">
        <div>
          <h3 className="text-brand-heading font-semibold text-sm">Billing Breakdown by Charge Type</h3>
          <p className="text-brand-muted text-[11px] mt-0.5">Plan subscriptions · user seats · add-ons · LC wallet charges</p>
        </div>
        <InfoTip position="top-end" text="Breakdown of monthly revenue by billing component. Requires billing sheet or Stripe connection." />
      </div>
      {stripeLoading ? (
        <div className="px-5 sm:px-6 py-6 animate-pulse space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <div className="h-3 bg-brand-border/30 rounded w-1/2" />
              <div className="h-3 bg-brand-border/20 rounded w-16" />
            </div>
          ))}
        </div>
      ) : (
      <div className="py-10 flex flex-col items-center gap-3 text-center px-6">
        <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-lg">💳</div>
        <div>
          <p className="text-brand-heading font-semibold text-sm">Billing Data Not Connected</p>
          <p className="text-brand-muted text-[12px] mt-1.5 leading-relaxed max-w-[360px]">
            Charge-type breakdown (Base Plan, User Seats, Add-ons, LC Platform Usage) will populate once billing data is connected.
            Requires: Stripe API key or the LGM billing sheet with planPrice, monthlyUserSub, addOns, and lcWalletCharges per client.
          </p>
        </div>
        <div className="w-full max-w-[420px] divide-y divide-brand-border border border-dashed border-brand-border rounded-xl overflow-hidden">
          {['📋  Base Plan Subscriptions', '👥  User Seat Fees', '➕  Add-On Charges', '⚡  LC Platform Usage'].map(label => (
            <div key={label} className="flex items-center justify-between px-4 py-3 bg-brand-bg/50">
              <span className="text-[12px] text-brand-muted">{label}</span>
              <span className="text-brand-border font-bold text-[13px]">—</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
          <span>⚠</span>
          <span>Data not received — connect Stripe or billing sheet to unlock this section</span>
        </div>
      </div>
      )}
    </div>
  )

  const rows = BILLING_ITEMS.map(item => {
    const active = accounts.filter(a => (a[item.field] || 0) > 0)
    const total  = active.reduce((s, a) => s + (a[item.field] || 0), 0)
    return { ...item, count: active.length, total }
  })

  const grandTotal = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.04)' }}>

      {/* Header */}
      <div className="px-5 sm:px-6 py-4 border-b border-brand-border flex items-start justify-between gap-3">
        <div>
          <h3 className="text-brand-heading font-semibold text-sm">Billing Breakdown by Charge Type</h3>
          <p className="text-brand-muted text-[11px] mt-0.5">
            Click any row to see which accounts have that charge · Total {fmt(grandTotal)}/mo across {accounts.length} accounts
          </p>
        </div>
        <InfoTip
          position="top-end"
          text="Breakdown of monthly revenue by billing component. Counts and totals reflect only accounts with a non-zero value for that charge type. Click any row to drill into the individual accounts."
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="border-b border-brand-border bg-brand-bg">
            <tr>
              <th className="px-5 sm:px-6 py-2.5 text-left text-brand-muted font-semibold uppercase text-[10px] tracking-wider">Charge Type</th>
              <th className="px-2 py-2.5 text-right text-brand-muted font-semibold uppercase text-[10px] tracking-wider"># Accounts</th>
              <th className="px-2 py-2.5 text-right text-brand-muted font-semibold uppercase text-[10px] tracking-wider">Total</th>
              <th className="px-5 sm:px-6 py-2.5 text-right text-brand-muted font-semibold uppercase text-[10px] tracking-wider">% of Revenue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-border">
            {rows.map(row => {
              const share = grandTotal > 0 ? Math.round((row.total / grandTotal) * 100) : 0
              const isOpen = expanded === row.key
              return (
                <>
                  <tr
                    key={row.key}
                    onClick={() => setExpanded(isOpen ? null : row.key)}
                    className={`cursor-pointer transition-colors ${isOpen ? 'bg-brand-bg' : 'hover:bg-brand-bg/60'}`}
                  >
                    <td className="px-5 sm:px-6 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{row.icon}</span>
                        <div>
                          <p className="text-brand-heading font-medium">{row.label}</p>
                          <p className="text-brand-muted text-[10px] mt-0.5 max-w-[280px]">{row.desc}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-3 text-right num font-semibold text-brand-muted">{row.count}</td>
                    <td className="px-2 py-3 text-right num font-bold text-brand-heading">{fmt(row.total)}</td>
                    <td className="px-5 sm:px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-brand-border overflow-hidden hidden sm:block">
                          <div className="h-full rounded-full bg-[#8CC63F]" style={{ width: `${share}%` }} />
                        </div>
                        <span className="num text-[11px] font-bold text-brand-heading w-8 text-right">{share}%</span>
                        <span className="text-brand-muted text-[10px] ml-1">{isOpen ? '▲' : '▼'}</span>
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={`${row.key}-drill`}>
                      <td colSpan={4} className="px-5 sm:px-6 pb-4 pt-0">
                        <DrilldownPanel
                          item={row}
                          accounts={accounts}
                          onClose={() => setExpanded(null)}
                        />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
          <tfoot className="border-t-2 border-brand-border bg-brand-bg">
            <tr>
              <td className="px-5 sm:px-6 py-3 text-brand-heading font-bold text-[12px]">Total</td>
              <td className="px-2 py-3 text-right num font-bold text-brand-heading">{accounts.length}</td>
              <td className="px-2 py-3 text-right num font-bold text-brand-heading">{fmt(grandTotal)}</td>
              <td className="px-5 sm:px-6 py-3 text-right num font-bold text-brand-heading">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* LC wallet note — this data is not in the GHL API */}
      <div className="px-5 sm:px-6 py-3 border-t border-brand-border flex items-center gap-2 text-[11px] text-brand-muted bg-brand-bg/60 rounded-b-2xl">
        <span className="flex-shrink-0">ℹ</span>
        <span>
          <strong>LC Platform Usage</strong> reflects all-time cumulative wallet charges from Cliff's migrated data.
          Per-account monthly breakdowns (SMS, AI, phone, email) are available in each account's detail modal.
        </span>
      </div>
    </div>
  )
}
