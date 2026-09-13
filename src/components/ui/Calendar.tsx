import { useEffect, useState } from 'react'
import { DayPicker, useDayPicker } from 'react-day-picker'
import type {
  DateRange,
  DayButtonProps,
  DayProps,
  MonthCaptionProps,
} from 'react-day-picker'
import { format, subDays, subMonths } from 'date-fns'
import { ChevronLeftSmall, ChevronRightSmall } from '@/generated/icons'

export type { DateRange }

// ─── Preset ranges ────────────────────────────────────────────────────────────

type Preset = 'last30' | 'last3m' | 'last6m' | 'lastYear' | 'allTime' | 'custom'

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'last30', label: 'Last 30 days' },
  { id: 'last3m', label: 'Last 3 months' },
  { id: 'last6m', label: 'Last 6 months' },
  { id: 'lastYear', label: 'Last year' },
  { id: 'allTime', label: 'All time' },
  { id: 'custom', label: 'Custom' },
]

function getPresetRange(id: Preset): DateRange | undefined {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  switch (id) {
    case 'last30':   return { from: subDays(today, 30), to: today }
    case 'last3m':   return { from: subMonths(today, 3), to: today }
    case 'last6m':   return { from: subMonths(today, 6), to: today }
    case 'lastYear': return { from: subMonths(today, 12), to: today }
    default:         return undefined
  }
}

// ─── Range endpoint shape decorator ──────────────────────────────────────────
// Concave quarter-circle corner accent. Identical SVG path for start and end;
// end variant is rotated 180° so the accent mirrors to the opposite corner.

const SHAPE_PATH =
  'M5.58579 0H4C1.79086 0 0 1.79086 0 4V5.58579C0 6.47669 1.07714 6.92286 1.70711 6.29289L6.29289 1.70711C6.92286 1.07714 6.47669 0 5.58579 0Z'

function RangeShape({ end = false }: { end?: boolean }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute size-2 ${end ? 'bottom-[3px] right-[3px]' : 'left-[3px] top-[3px]'}`}
    >
      <svg
        viewBox="0 0 6.58779 6.58779"
        fill="currentColor"
        className={`block size-full text-accent${end ? ' rotate-180' : ''}`}
      >
        <path d={SHAPE_PATH} />
      </svg>
    </span>
  )
}

// ─── Custom DayButton ─────────────────────────────────────────────────────────
// Renders the day number, today dot, and range endpoint shape decorators.

function CustomDayButton({ day, modifiers, onClick, onKeyDown, tabIndex, 'aria-label': ariaLabel }: DayButtonProps) {
  const isOutside  = !!modifiers.outside
  const isDisabled = !!modifiers.disabled
  const isToday    = !!modifiers.today
  const isStart    = !!modifiers.range_start
  const isEnd      = !!modifiers.range_end

  return (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={onKeyDown}
      tabIndex={tabIndex}
      aria-label={ariaLabel}
      disabled={isDisabled}
      className="relative flex size-8 cursor-pointer items-center justify-center text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span className={isOutside ? 'text-accent' : 'text-foreground'}>
        {format(day.date, 'd')}
      </span>
      {isToday && (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1 left-1/2 size-[3px] -translate-x-1/2 rounded-full bg-foreground"
        />
      )}
      {isStart && <RangeShape />}
      {isEnd   && <RangeShape end />}
    </button>
  )
}

// ─── Custom Day cell ──────────────────────────────────────────────────────────
// Controls per-cell background and border-radius for range/selected states.

function CustomDay({ day, modifiers, children }: DayProps) {
  const isStart    = !!modifiers.range_start
  const isEnd      = !!modifiers.range_end
  const isMiddle   = !!modifiers.range_middle
  const isRange    = isStart || isEnd || isMiddle
  const isSingle   = !!modifiers.selected && !isRange
  const isDisabled = !!modifiers.disabled

  // Round the left edge of any range cell that begins a week row (Monday)
  // or is the range start. Round the right edge for Sunday or range end.
  const dow        = day.date.getDay()
  const roundLeft  = isRange && (isStart || dow === 1)
  const roundRight = isRange && (isEnd   || dow === 0)

  const classes = [
    'relative size-8',
    isRange   && 'bg-muted',
    isSingle  && 'rounded-lg bg-muted',
    roundLeft  && roundRight && 'rounded-lg',
    roundLeft  && !roundRight && 'rounded-tl-lg rounded-bl-lg',
    roundRight && !roundLeft  && 'rounded-tr-lg rounded-br-lg',
    isDisabled && 'pointer-events-none opacity-50',
    !isRange && !isSingle && !isDisabled && 'hover:rounded-lg hover:bg-muted',
  ].filter(Boolean).join(' ')

  return <div className={classes}>{children}</div>
}

// ─── Custom MonthCaption ──────────────────────────────────────────────────────
// Renders month/year label with prev/next chevrons positioned absolutely.
// Left chevron only on the first column, right chevron only on the last.

function CustomMonthCaption({ calendarMonth, displayIndex }: MonthCaptionProps) {
  const { months, goToMonth, nextMonth, previousMonth } = useDayPicker()
  const isFirst = displayIndex === 0
  const isLast  = displayIndex === months.length - 1

  return (
    <div className="relative flex h-6 items-center justify-center">
      {isFirst && (
        <button
          type="button"
          onClick={() => previousMonth && goToMonth(previousMonth)}
          disabled={!previousMonth}
          aria-label="Go to previous month"
          className="absolute left-1.5 flex size-5 cursor-pointer items-center justify-center text-foreground transition-colors hover:text-accent disabled:cursor-default disabled:opacity-40"
        >
          <ChevronLeftSmall size={20} />
        </button>
      )}
      <span className="text-sm font-medium tracking-[-0.35px] text-foreground">
        {format(calendarMonth.date, 'MMMM yyyy')}
      </span>
      {isLast && (
        <button
          type="button"
          onClick={() => nextMonth && goToMonth(nextMonth)}
          disabled={!nextMonth}
          aria-label="Go to next month"
          className="absolute right-1.5 flex size-5 cursor-pointer items-center justify-center text-foreground transition-colors hover:text-accent disabled:cursor-default disabled:opacity-40"
        >
          <ChevronRightSmall size={20} />
        </button>
      )}
    </div>
  )
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

type CalendarProps =
  | {
      mode?: 'range'
      selected?: DateRange
      onSelect?: (value: DateRange | undefined) => void
      showPanel?: boolean
      numberOfMonths?: 1 | 2
      className?: string
    }
  | {
      mode: 'single'
      selected?: Date
      onSelect?: (value: Date | undefined) => void
      showPanel?: boolean
      numberOfMonths?: 1 | 2
      className?: string
    }

// The CalendarProps union makes `onSelect` uncallable as-is (incompatible
// signatures), so calls go through this runtime-honest widened type instead.
type SelectHandler = (value: DateRange | Date | undefined) => void

export function Calendar(props: CalendarProps) {
  const {
    mode = 'range',
    selected,
    onSelect,
    showPanel = false,
    numberOfMonths,
    className,
  } = props

  const months = numberOfMonths ?? (mode === 'range' ? 2 : 1)

  const [activePreset, setActivePreset] = useState<Preset>('allTime')

  // When selection clears externally, revert panel to "All time"
  useEffect(() => {
    if (!selected) setActivePreset('allTime')
  }, [selected])

  function handlePresetClick(preset: Preset) {
    setActivePreset(preset)
    // "Custom" just enters manual-pick mode: keep the panel open and any
    // existing range intact, then wait for the user to select days.
    if (preset === 'custom') return
    const range = getPresetRange(preset)
    ;(onSelect as SelectHandler | undefined)?.(range)
  }

  function handleSelect(value: DateRange | Date | undefined) {
    setActivePreset('custom')
    ;(onSelect as SelectHandler | undefined)?.(value)
  }

  return (
    <div
      className={`flex overflow-clip rounded-xl border border-borderLight bg-surface shadow-sm${className ? ` ${className}` : ''}`}
    >
      {showPanel && (
        <div className="flex w-32 shrink-0 flex-col gap-0.5 border-r border-borderLight p-2">
          {PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePresetClick(preset.id)}
              className={`flex h-8 w-full cursor-pointer items-center rounded px-2 text-left text-sm tracking-[-0.3px] transition-colors ${
                activePreset === preset.id
                  ? 'text-foreground'
                  : 'text-accent hover:text-foreground'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      <DayPicker
        mode={mode as 'range'}
        selected={selected as DateRange}
        onSelect={handleSelect}
        resetOnSelect
        numberOfMonths={months}
        weekStartsOn={1}
        showOutsideDays
        formatters={{ formatWeekdayName: d => format(d, 'EEEEE') }}
        classNames={{
          root:          'flex gap-2 p-2',
          months:        'flex gap-2',
          month:         'flex flex-col gap-1 pt-1',
          month_caption: '',
          nav:           '',
          month_grid:    '',
          weekdays:      '',
          weekday:       '',
          weeks:         '',
          week:          '',
          day:           '',
          day_button:    '',
          selected:      '',
          today:         '',
          outside:       '',
          disabled:      '',
          range_start:   '',
          range_middle:  '',
          range_end:     '',
          hidden:        'invisible',
          focused:       '',
        }}
        components={{
          Nav:           () => <></>,
          MonthCaption:  CustomMonthCaption,
          // Replace table elements with flex divs for layout control
          MonthGrid:     ({ children }) => <div className="flex flex-col gap-0.5" role="grid">{children}</div>,
          Weekdays:      ({ children }) => <div className="flex" aria-hidden="true">{children}</div>,
          Weekday:       ({ children }) => <div className="flex size-8 items-center justify-center text-xs font-normal text-accent">{children}</div>,
          Weeks:         ({ children }) => <div className="flex flex-col gap-0.5">{children}</div>,
          Week:          ({ children }) => <div className="flex" role="row">{children}</div>,
          Day:           CustomDay,
          DayButton:     CustomDayButton,
        }}
      />
    </div>
  )
}
