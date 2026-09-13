import { useEffect, useState } from 'react'
import type { ReactElement, ReactNode, SVGProps } from 'react'
import { colors } from '@/utils/tokens'
import * as CustomIcons from '@/generated/icons'
import { LOGO_REGISTRY } from '@/generated/logos'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { DATE_RANGES } from '@/types'
import type { DateRange } from '@/types'
import { DatePickerInput, type DateRange as DatePickerRange } from '@/components/ui/DatePickerInput'
import { Divider } from '@/components/ui/Divider'
import { Dropdown } from '@/components/ui/Dropdown'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { PageHeader } from '@/components/layout/PageHeader'
import { PnLValue } from '@/components/ui/PnLValue'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { StatCard } from '@/components/ui/StatCard'
import { Toast } from '@/components/ui/Toast'
import { Toggle } from '@/components/ui/Toggle'
import { Checkbox } from '@/components/ui/Checkbox'
import { Cross, Flashcards, Plus } from '@/generated/icons'
import { Avatar } from '@/components/ui/Avatar'
import { AnimatedButton } from '@/components/ui/animated-button'
import { DitheredLogo } from '@/components/ui/dithered-logo'
import { ColorDot } from '@/components/ui/ColorDot'
import { FilterItem } from '@/components/ui/FilterItem'
import { HoldingIcon } from '@/components/ui/HoldingIcon'
import { AccountIcon } from '@/components/ui/AccountIcon'
import { ACCOUNT_ICON_REGISTRY } from '@/components/ui/accountIconRegistry'
import { AllocationIcon } from '@/components/ui/AllocationIcon'
import type { AllocationType } from '@/components/ui/AllocationIcon'
import type { Account, Holding } from '@/types'
import { HoldingForm } from '@/features/accounts/HoldingForm'
import { AccountFormModal } from '@/features/accounts/AccountFormModal'
import { UnifiedImportModal } from '@/features/import/UnifiedImportModal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { CSVImportFlow } from '@/features/import/CSVImportFlow'
import { EMaklerImportFlow } from '@/features/import/EMaklerImportFlow'
import { XTBTransactionFlow } from '@/features/import/XTBTransactionFlow'
import { RevolutBtcFlow } from '@/features/import/RevolutBtcFlow'
import { RevolutCryptoFlow } from '@/features/import/RevolutCryptoFlow'
import { XTBConfirmationFlow } from '@/features/import/XTBConfirmationFlow'
import {
  csvHeaders,
  csvRows,
  csvDetectedFormat,
  csvSeed,
  eMaklerSeed,
  xtbSeed,
  btcSeed,
  ethSeed,
  xtbConfirmationSeed,
} from '@/dev/importFixtures'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <h2 className="text-base font-semibold text-foreground mb-1">{title}</h2>
      <Divider />
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Resolve a `var(--…)` token to the hex currently active on the root element. */
function resolveToken(value: string): string {
  const match = /^var\((--[\w-]+)\)$/.exec(value)
  if (!match) return value
  return getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim().toUpperCase()
}

/** Bumps on root `.dark` class changes so resolved hexes track the active theme. */
function useThemeVersion(): number {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion(v => v + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return version
}

function ColorSwatch({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5 w-28">
      <div
        className="w-full h-10 rounded-md border border-border"
        style={{ backgroundColor: value }}
      />
      <p className="text-xs font-medium text-foreground leading-tight">
        {name}
        {note && <span className="text-accent font-normal"> {note}</span>}
      </p>
      <p className="text-xs text-accent font-mono">{resolveToken(value)}</p>
    </div>
  )
}

function ColorPairSwatch({ name, main, foreground }: { name: string; main: string; foreground: string }) {
  return (
    <div className="flex flex-col items-start gap-1.5 w-28">
      <div className="w-full h-10 rounded-md border border-border overflow-hidden flex">
        <div className="flex-1" style={{ backgroundColor: main }} />
        <div
          className="flex-1 flex items-center justify-center text-xs font-semibold"
          style={{ backgroundColor: foreground, color: main }}
        >
          Aa
        </div>
      </div>
      <p className="text-xs font-medium text-foreground leading-tight">{name}</p>
      <p className="text-xs text-accent font-mono leading-tight">
        {resolveToken(main)}
        <br />
        {resolveToken(foreground)}
      </p>
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 mb-6">
      <p className="text-xs font-medium text-accent uppercase tracking-wide">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

/**
 * ModalShell — static preview of the redesigned modal chrome: a light `background`
 * surface with a compact header (title + close) wrapping a white inner card via the
 * `p-1.5` content gutter. Mirrors the live `Modal` `card` variant for /dev comparison.
 */
function ModalShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="w-[512px] max-w-full bg-background border border-border rounded-xl shadow-md overflow-hidden">
      <div className="flex items-center gap-2 px-6 pt-5 pb-3">
        <p className="flex-1 text-sm font-semibold text-foreground [font-feature-settings:'lnum'_1,'tnum'_1]">
          {title}
        </p>
        <button className="text-accent hover:text-foreground transition-colors cursor-pointer" aria-label="Close">
          <Cross size={20} />
        </button>
      </div>
      <div className="p-1.5">{children}</div>
    </div>
  )
}

/**
 * CardFlowFrame — reproduces the `Modal` `card` chrome (light `background` panel
 * plus a compact header on a `p-1.5` white-card gutter) so flows that render
 * their own white inner card preview faithfully. `header={false}` drops the
 * header for full-bleed states (e.g. the import success card).
 */
function CardFlowFrame({
  label,
  header = true,
  children,
}: {
  label: string
  header?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 mb-8">
      <p className="text-xs font-medium text-accent uppercase tracking-wide">{label}</p>
      <div className="w-[640px] max-w-full bg-background border border-border rounded-xl shadow-md overflow-hidden">
        {header && (
          <div className="flex items-center gap-2 px-6 pt-5 pb-3">
            <p className="flex-1 text-sm font-semibold text-foreground [font-feature-settings:'lnum'_1,'tnum'_1]">
              Import
            </p>
            <button className="text-accent hover:text-foreground transition-colors cursor-pointer" aria-label="Close">
              <Cross size={20} />
            </button>
          </div>
        )}
        <div className={header ? 'p-1.5' : ''}>{children}</div>
      </div>
    </div>
  )
}

const noop = () => {}
const DEMO_FILE = new File([], 'demo.csv')

// ─── Page ─────────────────────────────────────────────────────────────────────

type ToastVariant = 'basic' | 'undo' | 'action' | null

const STUB_ACCOUNTS: Account[] = [
  { id: '1', name: 'IKE PKO',    type: 'ike',       createdAt: '', lastUpdated: '', holdings: [] },
  { id: '2', name: 'IKZE PKO',   type: 'ikze',      createdAt: '', lastUpdated: '', holdings: [] },
  { id: '3', name: 'XTB',        type: 'brokerage', createdAt: '', lastUpdated: '', holdings: [] },
  { id: '4', name: 'Revolut',    type: 'crypto',    createdAt: '', lastUpdated: '', holdings: [] },
  { id: '5', name: 'mBank',      type: 'savings',   createdAt: '', lastUpdated: '', holdings: [] },
]

const STUB_ACCOUNTS_CUSTOM: Account[] = [
  { id: '6',  name: 'Custom 1', type: 'brokerage', iconId: 'palette',   createdAt: '', lastUpdated: '', holdings: [] },
  { id: '7',  name: 'Custom 2', type: 'ike',       iconId: 'target',    createdAt: '', lastUpdated: '', holdings: [] },
  { id: '8',  name: 'Custom 3', type: 'crypto',    iconId: 'zap',       createdAt: '', lastUpdated: '', holdings: [] },
  { id: '9',  name: 'Custom 4', type: 'savings',   iconId: 'heart',     createdAt: '', lastUpdated: '', holdings: [] },
  { id: '10', name: 'Custom 5', type: 'ikze',      iconId: 'sparkle', createdAt: '', lastUpdated: '', holdings: [] },
]

const ALLOCATION_TYPES: AllocationType[] = ['Bonds', 'Equity', 'Cash', 'Crypto']

const STUB_HOLDINGS: Holding[] = [
  { id: '1', accountId: 'a', name: 'NVIDIA',      ticker: 'NVDA', exchange: 'US', category: 'stock', quantity: 1, purchasePrice: 0, currentPrice: 0, purchaseDate: '', createdAt: '', updatedAt: '' },
  { id: '2', accountId: 'a', name: 'XTB',         ticker: 'XTB',  exchange: 'PL', category: 'stock', quantity: 1, purchasePrice: 0, currentPrice: 0, purchaseDate: '', createdAt: '', updatedAt: '' },
  { id: '3', accountId: 'a', name: 'Apple',        ticker: 'AAPL', exchange: 'US', category: 'stock', quantity: 1, purchasePrice: 0, currentPrice: 0, purchaseDate: '', createdAt: '', updatedAt: '' },
  { id: '4', accountId: 'a', name: 'VanEck Morningstar ETF', ticker: 'TDIV', exchange: 'US', category: 'etf',   quantity: 1, purchasePrice: 0, currentPrice: 0, purchaseDate: '', createdAt: '', updatedAt: '' },
]


export function DevShowcase() {
  const [toggle1, setToggle1] = useState(false)
  const [toggle2, setToggle2] = useState(true)
  const [checkbox1, setCheckbox1] = useState(false)
  const [checkbox2, setCheckbox2] = useState(true)
  const [dateRange, setDateRange] = useState<DateRange>('1M')
  const [pickerRange, setPickerRange] = useState<DatePickerRange | undefined>(undefined)
  const [dropdownVal, setDropdownVal] = useState('btc')
  const [activeToast, setActiveToast] = useState<ToastVariant>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [addAccountOpen, setAddAccountOpen] = useState(false)
  const [editAccountOpen, setEditAccountOpen] = useState(false)
  const [devConfirm, setDevConfirm] = useState<string | null>(null)
  const [devConfirmText, setDevConfirmText] = useState('')
  const themeVersion = useThemeVersion()

  const dropdownOptions = [
    { value: 'btc', label: 'Bitcoin (BTC)' },
    { value: 'eth', label: 'Ethereum (ETH)' },
    { value: 'sol', label: 'Solana (SOL)' },
  ]

  return (
    <div className="mx-auto max-w-[896px] w-full">
      <PageHeader title="Component Showcase" />

      {/* ------------------------------------------------------------------ */}
      <Section title="Avatar">
        <Row label="Icon">
          <Avatar size="xs" variant="icon" />
          <Avatar size="sm" variant="icon" />
          <Avatar size="md" variant="icon" />
        </Row>
        <Row label="Initials">
          <Avatar size="xs" variant="initials" initials="RM" />
          <Avatar size="sm" variant="initials" initials="RM" />
          <Avatar size="md" variant="initials" initials="RM" />
        </Row>
        <Row label="Image">
          <Avatar size="xs" variant="image" src="https://i.pravatar.cc/32?img=1" alt="User avatar" />
          <Avatar size="sm" variant="image" src="https://i.pravatar.cc/32?img=1" alt="User avatar" />
          <Avatar size="md" variant="image" src="https://i.pravatar.cc/32?img=1" alt="User avatar" />
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Button">
        <Row label="Variants — md">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Danger</Button>
        </Row>
        <Row label="With icon">
          <Button variant="primary" icon={Plus} iconPosition="left">Add account</Button>
          <Button variant="secondary" icon={Plus} iconPosition="left">Add</Button>
          <Button variant="ghost" icon={Plus} iconPosition="only" />
        </Row>
        <Row label="Disabled">
          <Button variant="primary" disabled>Primary</Button>
          <Button variant="secondary" disabled>Secondary</Button>
          <Button variant="ghost" disabled>Ghost</Button>
          <Button variant="destructive" disabled>Danger</Button>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="FilterItem">
        <Row label="Value formatting — no stack">
          <FilterItem label="Account" values={['IKE PKO']} valueLabel="accounts" onRemove={() => alert('remove')} onEdit={() => alert('edit')} />
          <FilterItem label="Account" values={['IKE PKO', 'XTB']} valueLabel="accounts" onRemove={() => alert('remove')} onEdit={() => alert('edit')} />
          <FilterItem label="Account" values={['IKE PKO', 'XTB', 'Revolut', 'mBank']} valueLabel="accounts" onRemove={() => alert('remove')} onEdit={() => alert('edit')} />
        </Row>
        <Row label="With ColorDot stack (type filter)">
          <FilterItem
            label="Type"
            values={['Dividend']}
            valueLabel="types"
            stackItems={[<ColorDot variant="positive" />]}
            onRemove={() => alert('remove')} onEdit={() => alert('edit')}
          />
          <FilterItem
            label="Type"
            values={['Dividend', 'Interest']}
            valueLabel="types"
            stackItems={[<ColorDot variant="positive" />, <ColorDot variant="positive" />]}
            onRemove={() => alert('remove')} onEdit={() => alert('edit')}
          />
          <FilterItem
            label="Type"
            values={['Dividend', 'Interest', 'Buy', 'Fee', 'Sell']}
            valueLabel="types"
            stackItems={[<ColorDot variant="positive" />, <ColorDot variant="positive" />, <ColorDot variant="neutral" />]}
            onRemove={() => alert('remove')} onEdit={() => alert('edit')}
          />
        </Row>
        <Row label="With HoldingIcon stack (instrument filter)">
          <FilterItem
            label="Instrument"
            values={['NVDA']}
            valueLabel="instruments"
            stackItems={[<HoldingIcon holding={STUB_HOLDINGS[0]} size={12} />]}
            onRemove={() => alert('remove')} onEdit={() => alert('edit')}
          />
          <FilterItem
            label="Instrument"
            values={['NVDA', 'XTB']}
            valueLabel="instruments"
            stackItems={STUB_HOLDINGS.slice(0, 2).map(h => <HoldingIcon holding={h} size={12} />)}
            onRemove={() => alert('remove')} onEdit={() => alert('edit')}
          />
          <FilterItem
            label="Instrument"
            values={['NVDA', 'XTB', 'AAPL', 'VanEck Morningstar ETF']}
            valueLabel="instruments"
            stackItems={STUB_HOLDINGS.slice(0, 3).map(h => <HoldingIcon holding={h} size={12} />)}
            onRemove={() => alert('remove')} onEdit={() => alert('edit')}
          />
        </Row>
        <Row label="ColorDot — variants">
          <ColorDot variant="positive" />
          <ColorDot variant="negative" />
          <ColorDot variant="warning" />
          <ColorDot variant="neutral" />
          <ColorDot variant="default" />
          <ColorDot variant="purple" />
          <ColorDot variant="blue" />
          <ColorDot variant="teal" />
          <ColorDot variant="lime" />
          <ColorDot variant="orange" />
          <ColorDot variant="fuchsia" />
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Badge">
        <Row label="Variants">
          <Badge variant="purple">Purple</Badge>
          <Badge variant="positive">Positive</Badge>
          <Badge variant="negative">Negative</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="blue">Blue</Badge>
          <Badge variant="fuchsia">Fuchsia</Badge>
          <Badge variant="teal">Teal</Badge>
          <Badge variant="lime">Lime</Badge>
          <Badge variant="orange">Orange</Badge>
          <Badge variant="ghost">Ghost</Badge>
        </Row>
        <Row label="With dot">
          <Badge variant="purple" showDot>Purple</Badge>
          <Badge variant="positive" showDot>Positive</Badge>
          <Badge variant="negative" showDot>Negative</Badge>
          <Badge variant="warning" showDot>Warning</Badge>
          <Badge variant="neutral" showDot>Neutral</Badge>
          <Badge variant="blue" showDot>Blue</Badge>
          <Badge variant="fuchsia" showDot>Fuchsia</Badge>
          <Badge variant="teal" showDot>Teal</Badge>
          <Badge variant="lime" showDot>Lime</Badge>
          <Badge variant="orange" showDot>Orange</Badge>
          <Badge variant="ghost" showDot>Ghost</Badge>
        </Row>
        <Row label="Ghost with colored dot">
          <Badge variant="ghost" showDot dotColor="positive">Active</Badge>
          <Badge variant="ghost" showDot dotColor="negative">Error</Badge>
          <Badge variant="ghost" showDot dotColor="warning">Pending</Badge>
          <Badge variant="ghost" showDot dotColor="blue">Info</Badge>
          <Badge variant="ghost" showDot dotColor="purple">Premium</Badge>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Input">
        <Row label="Default">
          <div className="w-56">
            <Input placeholder="Placeholder text" />
          </div>
          <div className="w-56">
            <Input label="Label" placeholder="With label" />
          </div>
        </Row>
        <Row label="Error state">
          <div className="w-56">
            <Input label="Amount" placeholder="0.00" error="Value is required" />
          </div>
        </Row>
        <Row label="Disabled">
          <div className="w-56">
            <Input label="Read-only" value="Cannot edit" disabled onChange={() => {}} />
          </div>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Dropdown / Select">
        <Row label="Default">
          <div className="w-56">
            <Dropdown
              options={dropdownOptions}
              value={dropdownVal}
              onChange={setDropdownVal}
            />
          </div>
          <div className="w-56">
            <Dropdown
              label="Asset"
              options={dropdownOptions}
              value={dropdownVal}
              onChange={setDropdownVal}
            />
          </div>
        </Row>
        <Row label="Active / xs size">
          <div className="w-44">
            <Dropdown
              options={dropdownOptions}
              value={dropdownVal}
              onChange={setDropdownVal}
              active
              size="xs"
            />
          </div>
        </Row>
        <Row label="Error state">
          <div className="w-56">
            <Dropdown
              label="Asset"
              options={dropdownOptions}
              value={dropdownVal}
              onChange={setDropdownVal}
              error="Please select an asset"
            />
          </div>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Toggle">
        <Row label="States">
          <div className="flex items-center gap-3">
            <Toggle checked={toggle1} onChange={setToggle1} label="Off" />
            <span className="text-sm text-accent">{toggle1 ? 'On' : 'Off'}</span>
          </div>
          <div className="flex items-center gap-3">
            <Toggle checked={toggle2} onChange={setToggle2} label="On" />
            <span className="text-sm text-accent">{toggle2 ? 'On' : 'Off'}</span>
          </div>
        </Row>
        <Row label="Disabled">
          <Toggle checked={false} onChange={() => {}} disabled label="Disabled off" />
          <Toggle checked={true} onChange={() => {}} disabled label="Disabled on" />
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Checkbox">
        <Row label="States">
          <Checkbox checked={checkbox1} onChange={setCheckbox1} label="Unchecked" />
          <Checkbox checked={checkbox2} onChange={setCheckbox2} label="Checked" />
        </Row>
        <Row label="No label">
          <Checkbox checked={checkbox1} onChange={setCheckbox1} />
          <Checkbox checked={checkbox2} onChange={setCheckbox2} />
        </Row>
        <Row label="Disabled">
          <Checkbox checked={false} onChange={() => {}} disabled label="Disabled unchecked" />
          <Checkbox checked={true} onChange={() => {}} disabled label="Disabled checked" />
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="SegmentedControl">
        <Row label="Interactive">
          <SegmentedControl options={DATE_RANGES} value={dateRange} onChange={setDateRange} />
        </Row>
      </Section>


      {/* ------------------------------------------------------------------ */}
      <Section title="DatePickerInput">
        <Row label="Interactive">
          <DatePickerInput value={pickerRange} onChange={setPickerRange} />
        </Row>
        <Row label="With quick-select panel">
          <DatePickerInput value={pickerRange} onChange={setPickerRange} showPanel />
        </Row>
        <Row label="Custom placeholder">
          <DatePickerInput value={pickerRange} onChange={setPickerRange} placeholder="Select range…" />
        </Row>
        <Row label="Single month">
          <DatePickerInput value={pickerRange} onChange={setPickerRange} numberOfMonths={1} />
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="ProgressBar">
        <Row label="Variants">
          <div className="flex flex-col gap-3 w-64">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-accent">Default 60%</span>
              <ProgressBar value={60} max={100} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-accent">Positive 80%</span>
              <ProgressBar value={80} max={100} variant="positive" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-accent">Negative 35%</span>
              <ProgressBar value={35} max={100} variant="negative" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-accent">Full 100%</span>
              <ProgressBar value={100} max={100} variant="positive" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-accent">Empty 0%</span>
              <ProgressBar value={0} max={100} />
            </div>
          </div>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="PnLValue">
        <Row label="Sizes — positive">
          <PnLValue value={1234.56} size="sm" />
          <PnLValue value={1234.56} size="md" />
          <PnLValue value={1234.56} size="lg" />
        </Row>
        <Row label="Sizes — negative">
          <PnLValue value={-543.21} size="sm" />
          <PnLValue value={-543.21} size="md" />
          <PnLValue value={-543.21} size="lg" />
        </Row>
        <Row label="With percent">
          <PnLValue value={1234.56} percent={5.4} size="sm" />
          <PnLValue value={-543.21} percent={-2.1} size="md" />
        </Row>
        <Row label="Detail mode & zero">
          <PnLValue value={1234.5678} detail size="md" />
          <PnLValue value={0} size="md" />
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="StatCard">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            label="Portfolio Value"
            value={125340}
            delta={2340}
            deltaPercent={1.9}
            period="this month"
          />
          <StatCard
            label="Total Return"
            value={18760}
            delta={-430}
            deltaPercent={-2.24}
            period="this month"
          />
          <StatCard
            label="Cash"
            value={4200}
            delta={0}
            deltaPercent={0}
            period="no change"
          />
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Card">
        <Row label="Static">
          <Card className="w-56">
            <p className="text-sm text-foreground font-medium">Static card</p>
            <p className="text-xs text-accent mt-1">No onClick handler</p>
          </Card>
        </Row>
        <Row label="Clickable (hover me)">
          <Card className="w-56" onClick={() => alert('clicked')}>
            <p className="text-sm text-foreground font-medium">Clickable card</p>
            <p className="text-xs text-accent mt-1">Has onClick — hover shows bg change</p>
          </Card>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="EmptyState">
        <Row label="With action">
          <div className="w-full border border-border rounded-lg">
            <EmptyState
              title="No accounts yet"
              description="Add your first investment account to start tracking your portfolio."
              action={{ label: 'Add account', onClick: () => {} }}
            />
          </div>
        </Row>
        <Row label="No action">
          <div className="w-full border border-border rounded-lg">
            <EmptyState
              title="Nothing to show"
              description="There are no transactions for the selected period."
            />
          </div>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="LoadingSpinner">
        <Row label="sm (inline)">
          <LoadingSpinner size="sm" />
        </Row>
        <Row label="page (centered in container)">
          <div className="w-full border border-border rounded-lg h-40 relative overflow-hidden">
            <LoadingSpinner size="page" />
          </div>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Divider">
        <div className="w-full">
          <p className="text-sm text-accent mb-2">Above</p>
          <Divider />
          <p className="text-sm text-accent mt-2">Below</p>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Toast">
        <Row label="Variants">
          <Button variant="secondary" onClick={() => setActiveToast('basic')}>Basic</Button>
          <Button variant="secondary" onClick={() => setActiveToast('undo')}>With Undo</Button>
          <Button variant="secondary" onClick={() => setActiveToast('action')}>With Action</Button>
        </Row>
      </Section>

      <Toast
        isOpen={activeToast === 'basic'}
        onClose={() => setActiveToast(null)}
        message="Transaction deleted successfully."
      />
      <Toast
        isOpen={activeToast === 'undo'}
        onClose={() => setActiveToast(null)}
        message="Transaction deleted."
        onUndo={() => setActiveToast(null)}
      />
      <Toast
        isOpen={activeToast === 'action'}
        onClose={() => setActiveToast(null)}
        message="Are you sure you want to remove this account?"
        action={{ label: 'Remove', onClick: () => setActiveToast(null) }}
      />

      {/* ------------------------------------------------------------------ */}
      <Section title="AnimatedButton">
        <Row label="Default">
          <AnimatedButton theme="light" mode="animated" onClick={() => {}} />
        </Row>
        <Row label="Custom icon">
          <AnimatedButton theme="light" icon={Flashcards} label="Add" mode="animated" onClick={() => {}} />
        </Row>

        <Row label="Auto (cursor tracking)">
          <AnimatedButton theme="light" mode="auto" onClick={() => {}} />
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="DitheredLogo">
        <Row label="Halftone (default, hover to interact)">
          <DitheredLogo size={160} />
        </Row>
        <Row label="Fine dither">
          <DitheredLogo size={160} style="fine" />
        </Row>
        <Row label="Diffuse (opaque, full-canvas dither)">
          <DitheredLogo size={160} style="diffuse" />
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="AccountIcon">
        <Row label="By type (default icon)">
          {STUB_ACCOUNTS.map(account => (
            <div key={account.id} className="flex flex-col items-center gap-1.5">
              <AccountIcon account={account} />
              <span className="text-xs text-accent">{account.type}</span>
            </div>
          ))}
        </Row>
        <Row label="With custom icon">
          {STUB_ACCOUNTS_CUSTOM.map(account => (
            <div key={account.id} className="flex flex-col items-center gap-1.5">
              <AccountIcon account={account} />
              <span className="text-xs text-accent">{account.iconId}</span>
            </div>
          ))}
        </Row>
        <Row label="All registry icons">
          <div className="flex flex-wrap gap-3">
            {Object.keys(ACCOUNT_ICON_REGISTRY).map(iconId => (
              <AccountIcon
                key={iconId}
                account={{ id: iconId, name: iconId, type: 'brokerage', iconId, createdAt: '', lastUpdated: '', holdings: [] }}
              />
            ))}
          </div>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="AllocationIcon">
        <Row label="All types">
          {ALLOCATION_TYPES.map(type => (
            <div key={type} className="flex flex-col items-center gap-1.5">
              <AllocationIcon type={type} />
              <span className="text-xs text-accent">{type}</span>
            </div>
          ))}
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* Derived from tokens.ts — new tokens show up here automatically. Keyed on
          themeVersion so resolved hexes re-read when the theme flips. */}
      <Section title="Colors" key={themeVersion}>
        {(() => {
          const keys = Object.keys(colors) as (keyof typeof colors)[]
          const fgOf = (k: string) => colors[`${k}Foreground` as keyof typeof colors]
          const isChart = (k: string) => k.startsWith('chartGroup')
          const isForeground = (k: string) => k.endsWith('Foreground')
          const pairKeys = keys.filter(k => !isChart(k) && fgOf(k) !== undefined)
          const SEMANTIC = new Set(['positive', 'negative', 'warning'])
          const semanticPairs = pairKeys.filter(k => SEMANTIC.has(k))
          const customPairs = pairKeys.filter(k => !SEMANTIC.has(k))
          const baseKeys = keys.filter(k => !isChart(k) && !isForeground(k) && !pairKeys.includes(k))
          const chartKeys = keys.filter(isChart)
          const aliasOf = (k: keyof typeof colors) => pairKeys.find(c => colors[c] === colors[k])

          return (
            <>
              <Row label="Base">
                {baseKeys.map(k => (
                  <ColorSwatch key={k} name={k} value={colors[k]} />
                ))}
              </Row>
              <Row label="Semantic — main + foreground">
                {semanticPairs.map(k => (
                  <ColorPairSwatch key={k} name={k} main={colors[k]} foreground={fgOf(k)!} />
                ))}
              </Row>
              <Row label="Custom — main + foreground">
                {customPairs.map(k => (
                  <ColorPairSwatch key={k} name={k} main={colors[k]} foreground={fgOf(k)!} />
                ))}
              </Row>
              <Row label="Chart — aliases of custom tokens">
                {chartKeys.map(k => (
                  <ColorSwatch key={k} name={k} value={colors[k]} note={`→ ${aliasOf(k) ?? '?'}`} />
                ))}
              </Row>
            </>
          )
        })()}
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Custom Icons">
        {(() => {
          const uiEntries = Object.entries(CustomIcons)
          // Logos live in their own @/generated/logos namespace; key is 'TICKER.EXCHANGE' or brand name.
          const logoEntries = Object.entries(LOGO_REGISTRY)
          const allEntries = uiEntries

          if (allEntries.length === 0) {
            return (
              <div className="border border-dashed border-border rounded-lg px-6 py-10 text-center">
                <p className="text-sm font-medium text-foreground">No custom icons yet</p>
                <p className="text-xs text-accent mt-1">
                  Drop SVG files into <code className="font-mono bg-border px-1 rounded">src/icons/raw/</code> and run{' '}
                  <code className="font-mono bg-border px-1 rounded">npm run icons</code>
                </p>
              </div>
            )
          }

          const boldFamilies = new Set(
            uiEntries.filter(([n]) => n.endsWith('Bold')).map(([n]) => n.slice(0, -4))
          )
          const plainFamilies = new Set(
            uiEntries.filter(([n]) => !n.endsWith('Bold')).map(([n]) => n)
          )
          const getFamily = (name: string) =>
            name.endsWith('Bold') ? name.slice(0, -4) : name

          const boldAndOutlineEntries = uiEntries.filter(([n]) => {
            const f = getFamily(n); return boldFamilies.has(f) && plainFamilies.has(f)
          })
          const boldOnlyEntries = uiEntries.filter(([n]) => {
            const f = getFamily(n); return boldFamilies.has(f) && !plainFamilies.has(f)
          })
          const otherEntries = uiEntries.filter(([n]) => !boldFamilies.has(getFamily(n)))

          // Accepts both UI icon entries and LOGO_REGISTRY entries — the
          // component types differ, and the cast below normalizes them anyway.
          const renderIconGrid = (entries: [string, unknown][]) => (
            <div className="flex flex-wrap gap-6">
              {entries.map(([name, Icon]) => {
                const C = Icon as (props: SVGProps<SVGSVGElement> & { size?: number }) => ReactElement
                return (
                  <div key={name} className="flex flex-col items-center gap-1.5 w-20">
                    <C size={24} className="text-foreground" />
                    <span className="text-xs text-accent text-center break-words w-full">{name}</span>
                  </div>
                )
              })}
            </div>
          )

          return (
            <>
              <p className="text-sm font-semibold text-foreground mb-2">UI Icons</p>
              <Row label="Bold + Outline variants">
                {renderIconGrid(boldAndOutlineEntries)}
              </Row>
              <Row label="Bold only">
                {renderIconGrid(boldOnlyEntries)}
              </Row>
              <Row label="Other">
                {renderIconGrid(otherEntries)}
              </Row>
              <Row label="Color variants (text-* classes)">
                <div className="flex flex-wrap gap-4">
                  {uiEntries.slice(0, 1).map(([name, Icon]) => {
                    const C = Icon as (props: SVGProps<SVGSVGElement> & { size?: number }) => ReactElement
                    return (
                      <div key={name} className="flex items-center gap-3">
                        <C size={24} className="text-foreground" />
                        <C size={24} className="text-accent" />
                        <C size={24} className="text-positive" />
                        <C size={24} className="text-negative" />
                        <C size={24} className="text-accent" />
                      </div>
                    )
                  })}
                </div>
              </Row>
              <Row label="Size scale">
                <div className="flex items-end gap-4">
                  {uiEntries.slice(0, 1).map(([name, Icon]) => {
                    const C = Icon as (props: SVGProps<SVGSVGElement> & { size?: number }) => ReactElement
                    return (
                      <div key={name} className="flex items-end gap-4">
                        {[12, 16, 20, 24, 32].map(s => (
                          <div key={s} className="flex flex-col items-center gap-1">
                            <C size={s} className="text-foreground" />
                            <span className="text-xs text-accent">{s}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </Row>

              <div className="my-4 border-t border-border" />

              <p className="text-sm font-semibold text-foreground mb-2">Logos</p>
              <Row label="24px (default)">
                {renderIconGrid(logoEntries)}
              </Row>
            </>
          )
        })()}
      </Section>

      {/* ================================================================== */}
      {/* Add & Import Flows                                                  */}
      {/* ================================================================== */}

      <Section title="Add / Edit — Holdings & Accounts">
        <div className="flex flex-wrap gap-8 items-start mb-8">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-accent uppercase tracking-wide">Add holding</p>
            <ModalShell title="Add Holding">
              <HoldingForm onSubmit={noop} onCancel={noop} />
            </ModalShell>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-accent uppercase tracking-wide">Edit holding</p>
            <ModalShell title="Edit Holding">
              <HoldingForm
                onSubmit={noop}
                onCancel={noop}
                defaultValues={{ name: 'NVIDIA', ticker: 'NVDA', exchange: 'US', category: 'stock', quantity: 10, purchasePrice: 400, currentPrice: 880, purchaseDate: '2024-02-01' }}
              />
            </ModalShell>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-accent uppercase tracking-wide">
            Add / Edit account (live preview + type-coloured gradient)
          </p>
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => setAddAccountOpen(true)}>Open Add Account</Button>
            <Button variant="secondary" onClick={() => setEditAccountOpen(true)}>Open Edit Account</Button>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Import wizard — entry chrome">
        <Row label="Live launcher (upload → account-selection steps)">
          <Button variant="primary" onClick={() => setImportOpen(true)}>Open import wizard</Button>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Confirm / destructive dialogs (shared ConfirmDialog, card chrome)">
        <Row label="All wired to the shared ConfirmDialog component">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setDevConfirm('deleteHolding')}>Delete Holding</Button>
            <Button variant="secondary" onClick={() => setDevConfirm('deleteAccountPanel')}>Delete Account (panel)</Button>
            <Button variant="secondary" onClick={() => setDevConfirm('deleteAccountDetail')}>Delete Account (detail)</Button>
            <Button variant="secondary" onClick={() => setDevConfirm('importBackup')}>Import Backup</Button>
            <Button variant="secondary" onClick={() => setDevConfirm('clearStep1')}>Clear All Data (1)</Button>
            <Button variant="secondary" onClick={() => { setDevConfirm('clearStep2'); setDevConfirmText('') }}>Confirm Deletion (2)</Button>
          </div>
        </Row>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Import — CSV (PKO IKE / XTB holdings / unknown)">
        <CardFlowFrame label="Mapping">
          <CSVImportFlow accountId="dev" accountName="XTB" accountType="ike" headers={csvHeaders} rawRows={csvRows} detectedFormat={csvDetectedFormat} onComplete={noop} onBack={noop} devSeed={csvSeed.mapping} />
        </CardFlowFrame>
        <CardFlowFrame label="Preview (update / new / remove + parse error)">
          <CSVImportFlow accountId="dev" accountName="XTB" accountType="brokerage" headers={csvHeaders} rawRows={csvRows} detectedFormat={null} onComplete={noop} onBack={noop} devSeed={csvSeed.preview} />
        </CardFlowFrame>
        <CardFlowFrame label="Done" header={false}>
          <CSVImportFlow accountId="dev" accountName="XTB" accountType="brokerage" headers={csvHeaders} rawRows={csvRows} detectedFormat={null} onComplete={noop} onBack={noop} devSeed={csvSeed.done} />
        </CardFlowFrame>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Import — eMakler">
        <CardFlowFrame label="Processing">
          <EMaklerImportFlow accountId="dev" accountName="eMakler" files={[]} onComplete={noop} onBack={noop} devSeed={eMaklerSeed.processing} />
        </CardFlowFrame>
        <CardFlowFrame label="Preview (add / update / remove + missing cost basis)">
          <EMaklerImportFlow accountId="dev" accountName="eMakler" files={[]} onComplete={noop} onBack={noop} devSeed={eMaklerSeed.preview} />
        </CardFlowFrame>
        <CardFlowFrame label="Done" header={false}>
          <EMaklerImportFlow accountId="dev" accountName="eMakler" files={[]} onComplete={noop} onBack={noop} devSeed={eMaklerSeed.done} />
        </CardFlowFrame>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Import — XTB transactions">
        <CardFlowFrame label="Parsing">
          <XTBTransactionFlow accountId="dev" file={DEMO_FILE} onComplete={noop} onBack={noop} devSeed={xtbSeed.parsing} />
        </CardFlowFrame>
        <CardFlowFrame label="Preview">
          <XTBTransactionFlow accountId="dev" file={DEMO_FILE} onComplete={noop} onBack={noop} devSeed={xtbSeed.preview} />
        </CardFlowFrame>
        <CardFlowFrame label="Unmatched instruments">
          <XTBTransactionFlow accountId="dev" file={DEMO_FILE} onComplete={noop} onBack={noop} devSeed={xtbSeed.unmatched} />
        </CardFlowFrame>
        <CardFlowFrame label="Cost-basis reconciliation">
          <XTBTransactionFlow accountId="dev" file={DEMO_FILE} onComplete={noop} onBack={noop} devSeed={xtbSeed.costBasis} />
        </CardFlowFrame>
        <CardFlowFrame label="Done" header={false}>
          <XTBTransactionFlow accountId="dev" file={DEMO_FILE} onComplete={noop} onBack={noop} devSeed={xtbSeed.done} />
        </CardFlowFrame>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Import — Revolut BTC">
        <CardFlowFrame label="Preview (quantity breakdown)">
          <RevolutBtcFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={btcSeed.preview} />
        </CardFlowFrame>
        <CardFlowFrame label="Receive cost basis">
          <RevolutBtcFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={btcSeed.receiveCost} />
        </CardFlowFrame>
        <CardFlowFrame label="Create / update holding">
          <RevolutBtcFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={btcSeed.createHolding} />
        </CardFlowFrame>
        <CardFlowFrame label="Done" header={false}>
          <RevolutBtcFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={btcSeed.done} />
        </CardFlowFrame>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Import — Revolut ETH">
        <CardFlowFrame label="Preview">
          <RevolutCryptoFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={ethSeed.preview} />
        </CardFlowFrame>
        <CardFlowFrame label="Create / update holding">
          <RevolutCryptoFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={ethSeed.createHolding} />
        </CardFlowFrame>
        <CardFlowFrame label="Done" header={false}>
          <RevolutCryptoFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={ethSeed.done} />
        </CardFlowFrame>
      </Section>

      {/* ------------------------------------------------------------------ */}
      <Section title="Import — XTB daily confirmation">
        <CardFlowFrame label="Preview (Buy/Sell badge unreadable — needs a manual choice)">
          <XTBConfirmationFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={xtbConfirmationSeed.preview} />
        </CardFlowFrame>
        <CardFlowFrame label="Preview (direction resolved by hand)">
          <XTBConfirmationFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={xtbConfirmationSeed.previewResolved} />
        </CardFlowFrame>
        <CardFlowFrame label="Done" header={false}>
          <XTBConfirmationFlow accountId="dev" files={[]} onComplete={noop} onBack={noop} devSeed={xtbConfirmationSeed.done} />
        </CardFlowFrame>
      </Section>

      <UnifiedImportModal isOpen={importOpen} onClose={() => setImportOpen(false)} />
      <AccountFormModal
        isOpen={addAccountOpen}
        onClose={() => setAddAccountOpen(false)}
        title="Add Account"
        submitLabel="Add"
        onSubmit={() => setAddAccountOpen(false)}
      />
      <AccountFormModal
        isOpen={editAccountOpen}
        onClose={() => setEditAccountOpen(false)}
        title="Edit Account"
        defaultValues={{ name: 'XTB', type: 'brokerage', notes: 'Main brokerage account' }}
        iconId="palette"
        onSubmit={() => setEditAccountOpen(false)}
      />

      {/* ── Confirm / destructive dialogs (shared ConfirmDialog) ── */}
      <ConfirmDialog
        isOpen={devConfirm === 'deleteHolding'}
        onClose={() => setDevConfirm(null)}
        onConfirm={() => setDevConfirm(null)}
        title="Delete Holding"
        message={<>Are you sure you want to delete <span className="font-medium text-foreground">NVIDIA</span>? This cannot be undone.</>}
        confirmLabel="Delete"
      />
      <ConfirmDialog
        isOpen={devConfirm === 'deleteAccountPanel'}
        onClose={() => setDevConfirm(null)}
        onConfirm={() => setDevConfirm(null)}
        title="Delete Account"
        message={<>Are you sure you want to delete <span className="font-medium text-foreground">XTB</span>? This cannot be undone. All holdings will be permanently removed.</>}
        confirmLabel="Delete"
      />
      <ConfirmDialog
        isOpen={devConfirm === 'deleteAccountDetail'}
        onClose={() => setDevConfirm(null)}
        onConfirm={() => setDevConfirm(null)}
        title="Delete Account"
        message={<>Are you sure you want to delete <span className="font-medium text-foreground">XTB</span>? This will permanently remove the account and all its holdings.</>}
        confirmLabel="Delete Account"
      />
      <ConfirmDialog
        isOpen={devConfirm === 'importBackup'}
        onClose={() => setDevConfirm(null)}
        onConfirm={() => setDevConfirm(null)}
        title="Import Backup"
        message="This will replace all your current data. Are you sure?"
        confirmLabel="Import"
        confirmVariant="primary"
      />
      <ConfirmDialog
        isOpen={devConfirm === 'clearStep1'}
        onClose={() => setDevConfirm(null)}
        onConfirm={() => setDevConfirm('clearStep2')}
        title="Clear All Data"
        message="This will permanently delete all your portfolio data."
        confirmLabel="Continue"
      />
      <ConfirmDialog
        isOpen={devConfirm === 'clearStep2'}
        onClose={() => { setDevConfirm(null); setDevConfirmText('') }}
        onConfirm={() => { setDevConfirm(null); setDevConfirmText('') }}
        title="Confirm Deletion"
        confirmLabel="Delete Everything"
        confirmDisabled={devConfirmText !== 'Delete'}
      >
        <Input
          label="Type Delete to confirm."
          type="text"
          value={devConfirmText}
          onChange={(e) => setDevConfirmText(e.target.value)}
          placeholder="Delete"
        />
      </ConfirmDialog>
    </div>
  )
}
