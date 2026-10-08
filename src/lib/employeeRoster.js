// Current LGM team (John, 2026-10-08). Only these names appear as employees on the
// Team AI Assistant dashboard and in Jarvis; anything else (former staff, "None",
// n8n's ambiguous guesses) is treated as unattributed.
export const EMPLOYEE_ROSTER = [
  'John Graham', 'Cliff Berman', 'Preslav Slavchev', 'Kylie Gomez', 'Steve Salcedo',
  'Juan Estupinan', 'Joe Perniciaro', 'Juan Trujillo', 'Jessica De la O', 'Olivia Taylor',
  'Rachel Jones', 'Kevin Wyatt', 'Hope Champion', 'Fabian Medina', 'Karen Cepeda',
  'Fernando Taborda', 'Manuela Ceballos', 'John Meza', 'Katherin Maldonado',
  'Sofia Naranjo', 'Yahaira Rodriguez',
  'Lead Delivery', 'LGM Support', 'Reporting Team',
]

// Spellings the call pipeline has produced that map onto a roster name
const ALIASES = {
  'kylie gomez vargas': 'Kylie Gomez',
  'jessica': 'Jessica De la O',
  'jessica de la o': 'Jessica De la O',
  'jessica (estupinan or trujillo)': 'Jessica De la O',
}

const byLower = new Map(EMPLOYEE_ROSTER.map(n => [n.toLowerCase(), n]))
const byFirst = EMPLOYEE_ROSTER.reduce((m, n) => {
  const f = n.split(' ')[0].toLowerCase()
  ;(m[f] ||= []).push(n)
  return m
}, {})

// Returns the roster name for a raw employee string, or null if not a current employee.
export function canonicalEmployee(raw) {
  const s = (raw || '').trim().replace(/\s+/g, ' ')
  if (!s) return null
  const lower = s.toLowerCase()
  if (['none', 'null', 'unknown', 'empty', 'n/a'].includes(lower)) return null
  if (byLower.has(lower)) return byLower.get(lower)
  if (ALIASES[lower]) return ALIASES[lower]
  const stripped = lower.replace(/\s*\(.*\)\s*$/, '')
  if (byLower.has(stripped)) return byLower.get(stripped)
  if (ALIASES[stripped]) return ALIASES[stripped]
  const first = byFirst[stripped.split(' ')[0]]
  if (first && first.length === 1) return first[0]
  return null
}
