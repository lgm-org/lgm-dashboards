const fmt = (n) => '$' + Math.round(n).toLocaleString()
const pct  = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)

export default function WalletDrilldown({ accounts, onClose }) {
  const withWallet = [...accounts]
    .filter(a => (a.lcWalletCharges || 0) > 0)
    .sort((a, b) => (b.lcWalletCharges || 0) - (a.lcWalletCharges || 0))

  const total  = withWallet.reduce((s, a) => s + a.lcWalletCharges, 0)
  const avg    = withWallet.length ? total / withWallet.length : 0
  const median = (() => {
    if (!withWallet.length) return 0
    const sorted = [...withWallet].sort((a, b) => a.lcWalletCharges - b.lcWalletCharges)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
      ? (sorted[mid - 1].lcWalletCharges + sorted[mid].lcWalletCharges) / 2
      : sorted[mid].lcWalletCharges
  })()

  return (
    <div className="animate-fade-in-up rounded-2xl border border-brand-border bg-white"
      style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.09)' }}>

      {/* Header */}
      <div className="px-5 sm:px-6 py-4 border-b border-brand-border flex items-center justify-between">
        <div>
          <h3 className="text-brand-heading font-semibold text-sm">LC Wallet Charges — Account Breakdown</h3>
          <p className="text-brand-muted text-[11px] mt-0.5">
            {withWallet.length} of {accounts.length} accounts have wallet activity · Total {fmt(total)}/mo
          </p>
        </div>
        <button onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-brand-muted hover:text-brand-heading hover:bg-brand-bg border border-brand-border text-sm">
          ✕
        </button>
      </div>

      {/* Summary stats row */}
      <div className="grid grid-cols-3 divide-x divide-brand-border border-b border-brand-border">
        {[
          { label: 'Total Wallet Spend', value: fmt(total) },
          { label: 'Average / Account',  value: fmt(avg) },
          { label: 'Median / Account',   value: fmt(median) },
        ].map(({ label, value }) => (
          <div key={label} className="px-5 py-3 text-center">
            <p className="text-brand-muted text-[10px] uppercase tracking-wider font-semibold">{label}</p>
            <p className="num text-brand-heading font-bold text-lg mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* Account table */}
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        {withWallet.length === 0 ? (
          <p className="text-brand-muted text-sm text-center py-10">No wallet activity data available.</p>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-brand-bg border-b border-brand-border">
              <tr>
                <th className="px-4 sm:px-6 py-2.5 text-left text-brand-muted font-semibold uppercase text-[10px] tracking-wider">#</th>
                <th className="px-2 py-2.5 text-left text-brand-muted font-semibold uppercase text-[10px] tracking-wider">Account</th>
                <th className="px-2 py-2.5 text-left text-brand-muted font-semibold uppercase text-[10px] tracking-wider hidden sm:table-cell">Type</th>
                <th className="px-2 py-2.5 text-right text-brand-muted font-semibold uppercase text-[10px] tracking-wider">Wallet Charges</th>
                <th className="px-2 py-2.5 text-right text-brand-muted font-semibold uppercase text-[10px] tracking-wider hidden sm:table-cell">Plan Rev</th>
                <th className="px-4 sm:px-6 py-2.5 text-right text-brand-muted font-semibold uppercase text-[10px] tracking-wider">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {withWallet.map((a, i) => {
                const share = pct(a.lcWalletCharges, total)
                const barW  = pct(a.lcWalletCharges, withWallet[0].lcWalletCharges)
                return (
                  <tr key={a.id} className="hover:bg-brand-bg/50 transition-colors">
                    <td className="px-4 sm:px-6 py-2.5 text-brand-muted">{i + 1}</td>
                    <td className="px-2 py-2.5">
                      <p className="text-brand-heading font-medium truncate max-w-[160px] sm:max-w-[240px]">{a.accountName}</p>
                      <div className="mt-1 h-1 w-full max-w-[120px] rounded-full bg-brand-border overflow-hidden">
                        <div className="h-full rounded-full bg-[#8CC63F]" style={{ width: `${barW}%` }} />
                      </div>
                    </td>
                    <td className="px-2 py-2.5 hidden sm:table-cell">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        (a.accountType || '').toLowerCase() === 'direct'
                          ? 'bg-blue-50 border-blue-200 text-blue-700'
                          : 'bg-purple-50 border-purple-200 text-purple-700'
                      }`}>{a.accountType || '—'}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right num font-semibold text-brand-heading">{fmt(a.lcWalletCharges)}</td>
                    <td className="px-2 py-2.5 text-right num text-brand-muted hidden sm:table-cell">{fmt(a.totalRev || 0)}</td>
                    <td className="px-4 sm:px-6 py-2.5 text-right">
                      <span className={`num text-[11px] font-bold ${share >= 5 ? 'text-amber-600' : 'text-brand-muted'}`}>
                        {share}%
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
