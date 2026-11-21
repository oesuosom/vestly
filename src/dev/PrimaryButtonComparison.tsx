// TEMPORARY (#39 design review). Delete this file, its use in DevShowcase and
// FORCE_HOVER in Button.tsx before the PR. Nothing outside /dev may import it.
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import { Plus } from '@/generated/icons'

type IconComponent = ComponentType<{ size?: number; className?: string }>
type ForceState = 'hover' | 'focus' | undefined

// Draws the browser's own keyboard focus ring without focusing the button.
const FORCE_FOCUS = '[outline:-webkit-focus-ring-color_auto_1px]'

// ─── Copy of the primary button as it is on main (fc09748) ───────────────────
// Only for this comparison. Do not reuse.

const CURRENT_GRADIENT =
  'linear-gradient(to bottom, rgba(255,255,255,.5) 0%, rgba(255,255,255,.1) 35%, rgba(255,255,255,.1) 50%, rgba(255,255,255,.25) 100%)'

const CURRENT_LAYOUT = {
  'md-none': 'h-9 px-4 py-2',
  'md-left': 'h-9 pl-3 pr-4 py-2 gap-1.5',
  'md-only': 'h-9 p-2',
  'lg-none': 'h-10 px-4 py-2',
} as const

function CurrentPrimaryButton({
  layout,
  icon: Icon,
  disabled,
  forceState,
  children,
  ...rest
}: {
  layout: keyof typeof CURRENT_LAYOUT
  icon?: IconComponent
  disabled?: boolean
  forceState?: ForceState
  children?: ReactNode
  'aria-label'?: string
}) {
  const forcedHover = forceState === 'hover' ? 'opacity-20' : 'opacity-0 group-hover:opacity-20'
  return (
    <button
      type="button"
      className={`group relative rounded-full overflow-clip flex items-center justify-center ${CURRENT_LAYOUT[layout]} bg-foreground gradient-border disabled:opacity-50 disabled:pointer-events-none cursor-pointer ${forceState === 'focus' ? FORCE_FOCUS : ''}`}
      style={{
        '--gradient-border': CURRENT_GRADIENT,
        boxShadow: '0 0 0 1px var(--color-foreground), 0 8px 16px -4px rgba(10,10,10,0.05)',
      } as React.CSSProperties}
      disabled={disabled}
      {...rest}
    >
      <div className={`absolute inset-0 bg-white ${forcedHover} transition-opacity pointer-events-none`} />
      {Icon && <Icon size={20} className="text-white relative z-10 shrink-0 group-disabled:opacity-50" />}
      {children && (
        <span className="relative z-10 text-white text-[14px] font-semibold tracking-[-0.35px] whitespace-nowrap group-disabled:opacity-50 [font-feature-settings:'lnum'_1,'tnum'_1]">
          {children}
        </span>
      )}
    </button>
  )
}

// ─── Contrast measured from what the browser actually draws ──────────────────

type Rgb = { r: number; g: number; b: number; a: number }

function parseColor(value: string): Rgb | null {
  const m = /rgba?\(([^)]+)\)/.exec(value)
  if (!m) return null
  const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  return { r, g, b, a }
}

function mix(front: Rgb, back: Rgb, alpha: number): Rgb {
  return {
    r: front.r * alpha + back.r * (1 - alpha),
    g: front.g * alpha + back.g * (1 - alpha),
    b: front.b * alpha + back.b * (1 - alpha),
    a: 1,
  }
}

function luminance(c: Rgb): number {
  const ch = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function hex(c: Rgb): string {
  return '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
}

type Measurement = { text: string; face: string; ratio: number }

/** Label colour against button colour, after the overlay and all opacities. */
function measure(button: HTMLButtonElement): Measurement | null {
  let panelBg: Rgb = { r: 255, g: 255, b: 255, a: 1 }
  for (let el = button.parentElement; el; el = el.parentElement) {
    const c = parseColor(getComputedStyle(el).backgroundColor)
    if (c && c.a > 0.99) { panelBg = c; break }
  }
  const bs = getComputedStyle(button)
  const bg = parseColor(bs.backgroundColor)
  const label = button.querySelector('span') ?? button.querySelector('svg')
  if (!bg || !label) return null
  const ls = getComputedStyle(label)
  const text = parseColor(ls.color)
  if (!text) return null
  let face = mix(bg, panelBg, bg.a)
  const overlay = button.querySelector<HTMLElement>(':scope > div')
  if (overlay) {
    const oc = parseColor(getComputedStyle(overlay).backgroundColor)
    const oo = Number(getComputedStyle(overlay).opacity)
    if (oc && oo > 0) face = mix(oc, face, oo * oc.a)
  }
  const textOnFace = mix(text, face, text.a * Number(ls.opacity))
  const buttonOpacity = Number(bs.opacity)
  const visibleFace = mix(face, panelBg, buttonOpacity)
  const visibleText = mix(textOnFace, panelBg, buttonOpacity)
  return { text: hex(visibleText), face: hex(visibleFace), ratio: contrast(visibleText, visibleFace) }
}

function Cell({ label, disabled, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [m, setM] = useState<Measurement | null>(null)
  useEffect(() => {
    // Wait for the overlay's opacity transition to finish.
    const id = window.setTimeout(() => {
      const button = ref.current?.querySelector('button')
      if (button) setM(measure(button))
    }, 400)
    return () => window.clearTimeout(id)
  }, [])
  const passes = m !== null && m.ratio >= 4.5
  return (
    <div className="flex flex-col items-start gap-1.5 min-w-0">
      <p className="text-[11px] font-medium text-foregroundMuted uppercase tracking-wide">{label}</p>
      <div ref={ref} className="h-11 flex items-center">{children}</div>
      {m && (
        <p className="text-[11px] leading-tight font-mono text-foregroundMuted">
          {m.text} on {m.face}
          <br />
          <span className={passes ? 'text-positive' : 'text-negative'}>
            {m.ratio.toFixed(2)}:1 {passes ? 'AA ✓' : 'fails AA'}
          </span>
          {disabled && <span> (AA not required)</span>}
        </p>
      )}
    </div>
  )
}

function CurrentRow() {
  return (
    <>
      <Cell label="Default"><CurrentPrimaryButton layout="md-none">Save</CurrentPrimaryButton></Cell>
      <Cell label="Hover"><CurrentPrimaryButton layout="md-none" forceState="hover">Save</CurrentPrimaryButton></Cell>
      <Cell label="Focus-visible"><CurrentPrimaryButton layout="md-none" forceState="focus">Save</CurrentPrimaryButton></Cell>
      <Cell label="Disabled" disabled><CurrentPrimaryButton layout="md-none" disabled>Save</CurrentPrimaryButton></Cell>
      <Cell label="Left icon"><CurrentPrimaryButton layout="md-left" icon={Plus}>Add</CurrentPrimaryButton></Cell>
      <Cell label="Icon only"><CurrentPrimaryButton layout="md-only" icon={Plus} aria-label="Add" /></Cell>
      <Cell label="Size md"><CurrentPrimaryButton layout="md-none">Save</CurrentPrimaryButton></Cell>
      <Cell label="Size lg"><CurrentPrimaryButton layout="lg-none">Save</CurrentPrimaryButton></Cell>
    </>
  )
}

function ProposedRow() {
  return (
    <>
      <Cell label="Default"><Button>Save</Button></Cell>
      <Cell label="Hover"><Button data-force-state="hover">Save</Button></Cell>
      <Cell label="Focus-visible"><Button className={FORCE_FOCUS}>Save</Button></Cell>
      <Cell label="Disabled" disabled><Button disabled>Save</Button></Cell>
      <Cell label="Left icon"><Button icon={Plus} iconPosition="left">Add</Button></Cell>
      <Cell label="Icon only"><Button icon={Plus} iconPosition="only" aria-label="Add" /></Cell>
      <Cell label="Size md"><Button size="md">Save</Button></Cell>
      <Cell label="Size lg"><Button size="lg">Save</Button></Cell>
    </>
  )
}

function Panel({ theme }: { theme: 'light' | 'dark' }) {
  return (
    <div className={`${theme === 'dark' ? 'dark' : ''} rounded-xl border border-border bg-background text-foreground p-4 flex flex-col gap-4 min-w-0`}>
      <p className="text-sm font-semibold">{theme === 'dark' ? 'Dark' : 'Light'}</p>
      {(['Current (main)', 'Proposed'] as const).map(row => (
        <div key={row} className="flex flex-col gap-2">
          <p className="text-xs font-semibold text-foreground">{row}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-4">
            {row === 'Proposed' ? <ProposedRow /> : <CurrentRow />}
          </div>
        </div>
      ))}
    </div>
  )
}

export function PrimaryButtonComparison() {
  const [rootIsDark, setRootIsDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setRootIsDark(root.classList.contains('dark')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return (
    <div className="mb-10 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Primary button: current vs proposed (temporary, #39)</p>
        <p className="text-xs text-foregroundMuted">
          Hover and focus are drawn without a pointer. Contrast is the label against the button, measured from the page.
        </p>
        {rootIsDark && (
          <p className="text-xs text-negative mt-1">Switch the app to the Light theme: the light panel can’t show light colours while the whole app is dark.</p>
        )}
      </div>
      <div key={String(rootIsDark)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Panel theme="light" />
        <Panel theme="dark" />
      </div>
    </div>
  )
}
