// Shared chat rendering for Jarvis Team Intelligence: markdown (with links),
// inline charts, CSV download blocks, tool-progress bubble, history sidebar.
import { useState } from 'react'
import { subDays, format } from 'date-fns'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

export const JARVIS_COLORS = ['#8CC63F', '#3B82F6', '#EAB308', '#FF6112', '#8B5CF6', '#06B6D4', '#84CC16', '#14B8A6']

// ── Inline markdown: **bold**, *em*, `code`, [text](url) ─────────────────────
function parseInline(text) {
  const parts = []
  const regex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g
  let last = 0, key = 0, m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[2] && m[3]) {
      parts.push(
        <a key={key++} href={m[3]} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-brand-green font-medium underline decoration-brand-green/40 hover:decoration-brand-green">
          {m[2]}<span aria-hidden className="text-[0.8em]">↗</span>
        </a>
      )
    } else if (m[4]) parts.push(<strong key={key++}>{m[4]}</strong>)
    else if (m[5])  parts.push(<em key={key++}>{m[5]}</em>)
    else parts.push(<code key={key++} className="bg-brand-bg/80 px-1 rounded text-[0.85em] font-mono">{m[6]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function MarkdownText({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const out = []
  let list = [], listType = null, key = 0
  const flush = () => {
    if (!list.length) return
    const Tag = listType === 'ol' ? 'ol' : 'ul'
    out.push(<Tag key={key++} className={`my-1 pl-5 space-y-0.5 ${Tag === 'ol' ? 'list-decimal' : 'list-disc'}`}>
      {list.map((item, i) => <li key={i} className="leading-relaxed">{parseInline(item)}</li>)}
    </Tag>)
    list = []; listType = null
  }
  for (const raw of lines) {
    const stripped = raw.replace(/^#{1,4}\s+/, '')
    const wasHeader = raw !== stripped
    const bullet = stripped.match(/^[-•*]\s+(.+)/)
    const numbed = stripped.match(/^\d+\.\s+(.+)/)
    if (bullet) { if (listType !== 'ul') { flush(); listType = 'ul' } list.push(bullet[1]); continue }
    if (numbed) { if (listType !== 'ol') { flush(); listType = 'ol' } list.push(numbed[1]); continue }
    flush()
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(stripped)) { out.push(<hr key={key++} className="my-3 border-brand-border" />); continue }
    if (!stripped.trim()) { out.push(<div key={key++} className="h-2" />); continue }
    out.push(<p key={key++} className={`leading-relaxed ${wasHeader ? 'font-semibold mt-2' : ''}`}>{parseInline(stripped)}</p>)
  }
  flush()
  return <div className="space-y-0.5">{out}</div>
}

// ── Chart block ───────────────────────────────────────────────────────────────
function ChartBlock({ spec }) {
  const { type = 'bar', title, xKey, yKey, nameKey, valueKey, data = [], color, note, direction } = spec
  if (!data?.length) return null
  const c = color || JARVIS_COLORS[0]
  const frame = children => (
    <div className="bg-brand-bg/40 border border-brand-border rounded-xl p-4 my-3">
      {title && <p className="text-[11px] font-semibold text-brand-heading mb-3">{title}</p>}
      {children}
      {note && <p className="text-[10px] text-brand-muted mt-2 italic">{note}</p>}
    </div>
  )
  if (type === 'pie') {
    const nk = nameKey || xKey || Object.keys(data[0])[0]
    const vk = valueKey || yKey || Object.keys(data[0])[1]
    return frame(
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey={vk} nameKey={nk} cx="50%" cy="50%" outerRadius={75} labelLine={false}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
            {data.map((_, i) => <Cell key={i} fill={JARVIS_COLORS[i % JARVIS_COLORS.length]} />)}
          </Pie>
          <Tooltip />
        </PieChart>
      </ResponsiveContainer>
    )
  }
  if (type === 'line') {
    return frame(
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7E5" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
          <Tooltip />
          <Line type="monotone" dataKey={yKey} stroke={c} strokeWidth={2} dot={{ r: 3, fill: c }} />
        </LineChart>
      </ResponsiveContainer>
    )
  }
  const vertical = direction === 'vertical'
  const h = vertical ? 200 : Math.max(160, Math.min(data.length * 28, 320))
  return frame(
    <ResponsiveContainer width="100%" height={h}>
      {vertical ? (
        <BarChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7E5" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
          <Tooltip />
          <Bar dataKey={yKey} fill={c} radius={[3, 3, 0, 0]} maxBarSize={32} />
        </BarChart>
      ) : (
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 20, left: 10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7E5" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey={xKey} tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} width={130} />
          <Tooltip />
          <Bar dataKey={yKey} fill={c} radius={[0, 3, 3, 0]} maxBarSize={20} />
        </BarChart>
      )}
    </ResponsiveContainer>
  )
}

const MIME = { csv: 'text/csv', md: 'text/markdown', txt: 'text/plain', json: 'application/json', html: 'text/html' }

// Handles ```csv-download and ```file-download blocks (csv, md, txt, json, html)
function CsvDownloadBlock({ spec }) {
  const { filename = 'report.csv', content = '' } = spec
  const [done, setDone] = useState(false)
  const ext = (filename.split('.').pop() || 'txt').toLowerCase()
  const rows = ext === 'csv' ? content.split('\n').filter(Boolean).length : null
  const size = content.length > 1024 ? `${(content.length / 1024).toFixed(1)} KB` : `${content.length} chars`
  function download() {
    const blob = new Blob([content], { type: `${MIME[ext] || 'text/plain'};charset=utf-8;` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    setDone(true)
  }
  return (
    <div className="bg-brand-bg/40 border border-brand-border rounded-xl px-4 py-3 my-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-brand-heading truncate">{filename}</p>
        <p className="text-[10px] text-brand-muted">{rows > 1 ? `${rows - 1} rows · ` : ''}{ext.toUpperCase()} · {size}</p>
      </div>
      <button onClick={download} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all"
        style={{ background: done ? '#f0f9e8' : '#8CC63F', color: done ? '#8CC63F' : 'white', borderColor: '#8CC63F' }}>
        {done ? 'Downloaded ✓' : 'Download'}
      </button>
    </div>
  )
}

export function RichContent({ text }) {
  if (!text) return null
  const parts = []
  const regex = /```(chart|csv-download|file-download)\s*([\s\S]*?)```/g
  let last = 0, m
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push({ type: 'text', content: text.slice(last, m.index) })
    try { parts.push({ type: m[1], spec: JSON.parse(m[2].trim()) }) } catch { parts.push({ type: 'text', content: m[0] }) }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ type: 'text', content: text.slice(last) })
  return (
    <div>
      {parts.map((p, i) =>
        p.type === 'chart' ? <ChartBlock key={i} spec={p.spec} />
        : (p.type === 'csv-download' || p.type === 'file-download') ? <CsvDownloadBlock key={i} spec={p.spec} />
        : <MarkdownText key={i} text={p.content} />
      )}
    </div>
  )
}

export function JarvisAvatar({ size = 28 }) {
  return (
    <div className="rounded-full flex-shrink-0 flex items-center justify-center"
      style={{ width: size, height: size, background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2z" fill="white" />
        <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" fill="white" opacity=".8" />
      </svg>
    </div>
  )
}

export function TypingBubble({ toolEvents = [] }) {
  return (
    <div className="flex justify-start mb-3">
      <div className="mr-2 mt-0.5"><JarvisAvatar /></div>
      <div className="bg-white border border-brand-border rounded-2xl rounded-bl-sm px-4 py-3">
        {toolEvents.length ? (
          <div className="space-y-1.5 text-[11px]">
            {toolEvents.map((ev, i) => {
              const done = i < toolEvents.length - 1
              return (
                <div key={i} className={`flex items-center gap-2 ${done ? 'opacity-50' : ''}`}>
                  {done
                    ? <span className="text-brand-green text-[10px]">✓</span>
                    : <span className="w-3 h-3 rounded-full border-2 flex-shrink-0 animate-spin" style={{ borderColor: '#8CC63F', borderTopColor: 'transparent' }} />}
                  <span className={done ? 'text-brand-muted line-through' : 'text-brand-heading font-medium'}>{ev}</span>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center gap-1 py-0.5">
            {[0, 1, 2].map(i => <span key={i} className="w-1.5 h-1.5 rounded-full bg-brand-muted/50 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
          </div>
        )}
      </div>
    </div>
  )
}

export function MessageBubble({ msg }) {
  if (msg.typing) return <TypingBubble toolEvents={msg.toolEvents || []} />
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      {!isUser && <div className="mr-2 mt-0.5"><JarvisAvatar /></div>}
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${isUser ? 'text-white rounded-br-sm' : 'bg-white border border-brand-border text-brand-text rounded-bl-sm'}`}
        style={isUser ? { background: 'linear-gradient(135deg, #8CC63F, #6aab2e)' } : {}}>
        {isUser ? <p className="leading-relaxed whitespace-pre-wrap">{msg.content}</p> : <RichContent text={msg.content} />}
      </div>
    </div>
  )
}

// ── History sidebar ───────────────────────────────────────────────────────────
function groupByDate(chats) {
  const today = format(new Date(), 'yyyy-MM-dd'), yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd'), weekAgo = format(subDays(new Date(), 7), 'yyyy-MM-dd')
  const groups = { Today: [], Yesterday: [], 'Last 7 days': [], Older: [] }
  for (const c of chats) {
    const d = (c.updated_at || '').slice(0, 10)
    if (d === today) groups.Today.push(c)
    else if (d === yesterday) groups.Yesterday.push(c)
    else if (d >= weekAgo) groups['Last 7 days'].push(c)
    else groups.Older.push(c)
  }
  return groups
}

export function HistorySidebar({ chats, currentId, onSelect, onDelete, onNewChat }) {
  const groups = groupByDate(chats)
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-brand-border">
        <button onClick={onNewChat}
          className="w-full text-[12px] font-medium text-brand-heading bg-white border border-brand-border rounded-xl py-2 hover:border-brand-green hover:text-brand-green transition-colors">
          + New conversation
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {Object.entries(groups).map(([group, items]) => items.length ? (
          <div key={group}>
            <p className="text-[9px] uppercase tracking-wider text-brand-muted/60 px-2 py-1.5 font-semibold">{group}</p>
            {items.map(chat => (
              <div key={chat.id} onClick={() => onSelect(chat.id)}
                className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer text-[11px] hover:bg-brand-bg transition-colors ${chat.id === currentId ? 'bg-brand-bg/80 font-medium text-brand-heading' : 'text-brand-text'}`}>
                <span className="flex-1 truncate">{chat.title}</span>
                <button onClick={e => { e.stopPropagation(); onDelete(chat.id) }} title="Delete"
                  className="opacity-0 group-hover:opacity-100 text-brand-muted hover:text-brand-heading flex-shrink-0 px-1">×</button>
              </div>
            ))}
          </div>
        ) : null)}
        {!chats.length && <p className="text-[11px] text-brand-muted/60 text-center py-8 px-3">Your conversations will appear here.</p>}
      </div>
    </div>
  )
}
