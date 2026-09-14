// Per John/Syed (2026-09-15): every other tab was a placeholder with no
// content yet, so they're hidden from the tab bar until each one actually
// gets built — only re-add an entry here once that tab has real content.
// The underlying EmptyTabScreen/activeTab plumbing in MasterDashboard.jsx is
// untouched, so restoring a tab later is a one-line change back.
export const TABS = [
  { key: 'lead-details',       label: 'Lead Details' },
]

export default function MasterTabBar({ active, onChange }) {
  return (
    <div className="bg-white border-b border-brand-border overflow-x-auto">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 flex gap-1 min-w-max">
        {TABS.map(tab => {
          const isActive = tab.key === active
          return (
            <button
              key={tab.key}
              onClick={() => onChange(tab.key)}
              className={`px-3.5 py-3 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                isActive
                  ? 'text-brand-heading'
                  : 'text-brand-muted border-transparent hover:text-brand-heading'
              }`}
              style={isActive ? { borderColor: '#8CC63F' } : undefined}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
