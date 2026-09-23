import { useState, useRef, useLayoutEffect, useEffect } from 'react'
import { createPortal } from 'react-dom'

const WIDTH  = 300
const MARGIN = 8

// Rendered through a portal with fixed positioning so cards/tables with
// overflow-hidden or overflow-x-auto can never clip the tooltip text.
export default function InfoTip({ text, position = 'top-end' }) {
  const [show, setShow] = useState(false)
  const [pos, setPos]   = useState(null)
  const btnRef = useRef(null)
  const tipRef = useRef(null)

  useLayoutEffect(() => {
    if (!show) { setPos(null); return }
    const r    = btnRef.current?.getBoundingClientRect()
    const tipH = tipRef.current?.offsetHeight ?? 0
    if (!r) return
    let left = position.endsWith('start') ? r.left : r.right - WIDTH
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - WIDTH - MARGIN))
    const spaceAbove = r.top - MARGIN
    const spaceBelow = window.innerHeight - r.bottom - MARGIN
    const wantTop    = position.startsWith('top')
    const placeTop   = wantTop ? tipH <= spaceAbove || spaceAbove > spaceBelow
                               : tipH > spaceBelow && spaceAbove > spaceBelow
    const top = placeTop ? r.top - tipH - MARGIN : r.bottom + MARGIN
    setPos({ left, top: Math.max(MARGIN, top) })
  }, [show, position, text])

  useEffect(() => {
    if (!show) return
    const hide = () => setShow(false)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [show])

  return (
    <span className="relative inline-flex flex-shrink-0"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      <button
        ref={btnRef}
        className="w-4 h-4 rounded-full border border-brand-border bg-brand-bg text-brand-muted text-[9px] font-bold flex items-center justify-center cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
        tabIndex={0}
        aria-label="More info"
        type="button"
      >
        ?
      </button>
      {show && createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          className="fixed z-[200] text-[11px] leading-relaxed text-brand-heading bg-white border border-brand-border rounded-xl px-3 py-2.5 pointer-events-none whitespace-pre-line"
          style={{
            width: WIDTH,
            left: pos?.left ?? 0,
            top:  pos?.top  ?? 0,
            visibility: pos ? 'visible' : 'hidden',
            boxShadow: '0 6px 20px rgba(0,0,0,0.14)',
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  )
}
