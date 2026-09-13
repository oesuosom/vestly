export const colors = {
  // ── Base (Figma: 3. Mode / Base/*) ────────────────────────────────────────
  background:      'var(--color-background)',
  surface:         'var(--color-surface)',
  foreground:      'var(--color-foreground)',
  muted:           'var(--color-muted)',
  foregroundMuted: 'var(--color-foreground-muted)',
  accent:          'var(--color-accent)',
  border:          'var(--color-border)',
  borderLight:     'var(--color-border-light)',
  input:           'var(--color-input)',

  // ── Semantic (Figma: 3. Mode / Semantic/*) ────────────────────────────────
  positive:           'var(--color-positive)',
  positiveForeground: 'var(--color-positive-foreground)',
  negative:           'var(--color-negative)',
  negativeForeground: 'var(--color-negative-foreground)',
  warning:            'var(--color-warning)',
  warningForeground:  'var(--color-warning-foreground)',

  // ── Custom (Figma: 3. Mode / Custom/*) ───────────────────────────────────
  blue:              'var(--color-blue)',
  blueForeground:    'var(--color-blue-foreground)',
  green:             'var(--color-green)',
  greenForeground:   'var(--color-green-foreground)',
  purple:            'var(--color-purple)',
  purpleForeground:  'var(--color-purple-foreground)',
  fuchsia:           'var(--color-fuchsia)',
  fuchsiaForeground: 'var(--color-fuchsia-foreground)',
  lime:              'var(--color-lime)',
  limeForeground:    'var(--color-lime-foreground)',
  teal:              'var(--color-teal)',
  tealForeground:    'var(--color-teal-foreground)',
  neutral:           'var(--color-neutral)',
  neutralForeground: 'var(--color-neutral-foreground)',
  orange:            'var(--color-orange)',
  orangeForeground:  'var(--color-orange-foreground)',
  rose:              'var(--color-rose)',
  roseForeground:    'var(--color-rose-foreground)',

  // ── Chart (project-specific, not in Figma) ────────────────────────────────
  chartGroupBonds:  'var(--color-blue)',
  chartGroupEquity: 'var(--color-purple)',
  chartGroupCash:   'var(--color-neutral)',
  chartGroupCrypto: 'var(--color-orange)',
} as const

/**
 * Global overlay/portal stacking order, bottom → top.
 *
 * This is the single source of truth for app-wide layering. Anything that
 * portals to <body> or is `fixed` full-screen belongs here so the relative
 * order stays obvious and conflicts (e.g. a confirmation Modal rendering
 * *under* the Settings dialog) can't recur.
 *
 * Use the Tailwind utilities (`z-modal`, `z-toast`, …) in className strings.
 * For computed inline styles (popovers positioned from getBoundingClientRect)
 * read the numeric value directly: `zIndex: z.popover`.
 *
 * NOTE: purely-local stacking inside a single component (e.g. `relative z-10`
 * for an icon over a background) is intentionally NOT part of this scale.
 */
export const z = {
  chrome:                10, // sidebar / app frame
  'panel-backdrop':      40,
  panel:                 50, // slide panel (account)
  'panel-nested-backdrop': 60,
  'panel-nested':        70, // nested slide panel (holding over account)
  dialog:                90, // full-screen dialog (settings)
  modal:                 95, // confirmation / form modals — always above dialogs
  popover:               98, // anchored floating menus, dropdowns, date pickers
  toast:                100, // top-most, never obscured
} as const
