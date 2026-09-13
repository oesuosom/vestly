import { useState } from 'react'
import 'slot-text/style.css'
import { SlotText } from 'slot-text/react'

export type DonutGroup = {
  name: string
  /** Share of the portfolio as a percentage (0–100) — not a PLN amount. */
  value: number
  color: string
}

type AllocationDonutProps = {
  groups: DonutGroup[]
  size?: number
  /** Portfolio total in PLN. Used with each group's percentage to label the centre. */
  totalValue?: number
  /** Label the centre with the percentage instead of the PLN amount. */
  showAsPercent?: boolean
}

// ─── SVG arc helpers ──────────────────────────────────────────────────────────

const D = Math.PI / 180  // deg → rad

/** Cartesian point on a circle. deg=0 is 12-o'clock, increases CW. */
function ptAt(cx: number, cy: number, r: number, deg: number) {
  const a = (deg - 90) * D
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}

/**
 * Tangent points for the small corner circle of radius `rc` that sits inside
 * the ring, touching the arc (at radius `arcR`) and the radial edge (at `edgeDeg`).
 *
 * inner=false → outer arc: corner circle centre at arcR − rc
 * inner=true  → inner arc: corner circle centre at arcR + rc
 * start=true  → corner is at the start edge (theta added), false → end edge (subtracted)
 */
function cornerTangents(
  cx: number, cy: number,
  arcR: number, edgeDeg: number,
  rc: number, inner: boolean, start: boolean,
) {
  const cr = inner ? arcR + rc : arcR - rc   // distance from chart centre to corner circle centre
  const sinT = rc / cr
  if (sinT >= 1) return null                 // rc too large for this arc radius
  const t = Math.asin(sinT)                  // radians
  const arcDeg = start ? edgeDeg + t / D : edgeDeg - t / D
  return {
    onArc:    ptAt(cx, cy, arcR, arcDeg),            // tangent point on the arc
    onRadial: ptAt(cx, cy, cr * Math.cos(t), edgeDeg), // tangent point on the radial edge
  }
}

function sectorPath(
  cx: number, cy: number,
  innerR: number, outerR: number,
  a1: number, a2: number,
  rc = 0,
): string {
  const sweep = a2 - a1
  const large = sweep > 180 ? 1 : 0
  const f = (p: { x: number; y: number }) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`

  if (rc <= 0) {
    const o1 = ptAt(cx, cy, outerR, a1), o2 = ptAt(cx, cy, outerR, a2)
    const i1 = ptAt(cx, cy, innerR, a1), i2 = ptAt(cx, cy, innerR, a2)
    return `M${f(o1)} A${outerR},${outerR} 0 ${large},1 ${f(o2)} L${f(i2)} A${innerR},${innerR} 0 ${large},0 ${f(i1)}Z`
  }

  const ocs = cornerTangents(cx, cy, outerR, a1, rc, false, true)
  const oce = cornerTangents(cx, cy, outerR, a2, rc, false, false)
  const ice = cornerTangents(cx, cy, innerR, a2, rc, true,  false)
  const ics = cornerTangents(cx, cy, innerR, a1, rc, true,  true)

  // Fall back to sharp corners if rc doesn't fit (very narrow sectors)
  if (!ocs || !oce || !ice || !ics) return sectorPath(cx, cy, innerR, outerR, a1, a2, 0)

  return [
    `M${f(ocs.onRadial)}`,
    `A${rc},${rc} 0 0,1 ${f(ocs.onArc)}`,                      // outer-start corner (CW)
    `A${outerR},${outerR} 0 ${large},1 ${f(oce.onArc)}`,       // main outer arc    (CW)
    `A${rc},${rc} 0 0,1 ${f(oce.onRadial)}`,                   // outer-end corner  (CW)
    `L${f(ice.onRadial)}`,                                      // radial edge
    `A${rc},${rc} 0 0,1 ${f(ice.onArc)}`,                      // inner-end corner  (CW)
    `A${innerR},${innerR} 0 ${large},0 ${f(ics.onArc)}`,       // main inner arc    (CCW)
    `A${rc},${rc} 0 0,1 ${f(ics.onRadial)}`,                   // inner-start corner (CW)
    'Z',
  ].join(' ')
}

// ─── Component ────────────────────────────────────────────────────────────────

const CORNER_RADIUS = 3       // base segment corner radius
const PADDING_ANGLE = 3       // degrees between segments
const RING_GAP = 3            // gap between base segment and active outer ring
const RING_THICKNESS = 2      // thickness of the active outer ring
const RING_CORNER_RADIUS = 1  // corner radius of the outer ring

export function AllocationDonut({ groups, size = 180, totalValue = 0, showAsPercent = false }: AllocationDonutProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-accent" style={{ width: size, height: size }}>
        No allocation data
      </div>
    )
  }

  const cx = size / 2, cy = size / 2
  const outerR = size * 0.46
  const innerR = size * 0.38
  const total  = groups.reduce((s, g) => s + g.value, 0)

  // Each sector starts where every preceding sector's sweep ended. Computed
  // from a prefix sum rather than a mutated running variable, which the
  // react-hooks immutability rule rejects in a render body. The prefix sum is
  // quadratic, but `groups` is a handful of allocation buckets and this is far
  // cheaper than the arc-path maths below it.
  const sectors = groups.map((g, i) => {
    const start = (groups.slice(0, i).reduce((sum, p) => sum + p.value, 0) / total) * 360
    const sweep = (g.value / total) * 360
    return { ...g, a1: start + PADDING_ANGLE / 2, a2: start + sweep - PADDING_ANGLE / 2 }
  })

  const active = activeIndex !== null ? groups[activeIndex] : null

  return (
    <div
      className="relative overflow-visible"
      style={{ width: size, height: size }}
      onMouseLeave={() => setActiveIndex(null)}
    >
      <svg width={size} height={size} overflow="visible">
        {sectors.map((s, i) => (
          <g key={i} onMouseEnter={() => setActiveIndex(i)} style={{ cursor: 'pointer' }}>
            <path
              d={sectorPath(cx, cy, innerR, outerR, s.a1, s.a2, CORNER_RADIUS)}
              fill={s.color}
            />
            <path
              d={sectorPath(cx, cy, outerR + RING_GAP, outerR + RING_GAP + RING_THICKNESS, s.a1, s.a2, RING_CORNER_RADIUS)}
              fill={s.color}
              style={{
                opacity: activeIndex === i ? 1 : 0,
                transition: 'opacity 200ms ease',
                pointerEvents: 'none',
              }}
            />
          </g>
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 pointer-events-none text-center">
        <p className="text-[20px] font-bold leading-none text-foreground">
          <SlotText
            text={
              showAsPercent
                ? `${(active ? active.value : 100).toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%`
                : (active ? (active.value / 100) * totalValue : totalValue).toLocaleString('pl-PL', {
                    maximumFractionDigits: 0,
                  })
            }
            options={{ skipUnchanged: false }}
          />
        </p>
      </div>
    </div>
  )
}
