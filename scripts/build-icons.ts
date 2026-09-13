#!/usr/bin/env tsx
/**
 * Converts SVGs into typed React components. Two independent namespaces:
 *
 *   UI icons  — src/generated/icons/raw/*.svg  → @/generated/icons  (monochrome, currentColor)
 *   Logos     — src/generated/logos/raw/*.svg  → @/generated/logos  (full-color brand marks)
 *
 * Usage:
 *   npm run icons
 *
 * UI icon workflow:
 *   1. Export an SVG from Figma (Frame → Export → SVG)
 *   2. Drop it into src/generated/icons/raw/my-icon-name.svg
 *   3. Run npm run icons
 *   4. Import: import { MyIconName } from '@/generated/icons'
 *
 * Logo workflow:
 *   1. Drop a full-bleed 24×24 SVG into src/generated/logos/raw/<TICKER.EXCHANGE>.svg
 *      (or <BrandName>.svg for ETF providers matched by name)
 *   2. Run npm run icons — the LOGO_REGISTRY in @/generated/logos is regenerated from the
 *      filenames, so there is NO manual registry step. The filename IS the key.
 */

import fs from 'fs'
import path from 'path'

const RAW_DIR   = 'src/generated/icons/raw'
const COMP_DIR  = 'src/generated/icons/components'
const INDEX     = 'src/generated/icons/index.ts'

const LOGO_RAW_DIR  = 'src/generated/logos/raw'
const LOGO_COMP_DIR = 'src/generated/logos/components'
const LOGO_INDEX    = 'src/generated/logos/index.ts'
const LOGO_REGISTRY = 'src/generated/logos/registry.ts'

// SVG HTML attributes → JSX camelCase props
const ATTR_MAP: Record<string, string> = {
  'stroke-width':                  'strokeWidth',
  'stroke-linecap':                'strokeLinecap',
  'stroke-linejoin':               'strokeLinejoin',
  'stroke-miterlimit':             'strokeMiterlimit',
  'stroke-dasharray':              'strokeDasharray',
  'stroke-dashoffset':             'strokeDashoffset',
  'stroke-opacity':                'strokeOpacity',
  'fill-rule':                     'fillRule',
  'fill-opacity':                  'fillOpacity',
  'clip-rule':                     'clipRule',
  'clip-path':                     'clipPath',
  'stop-color':                    'stopColor',
  'stop-opacity':                  'stopOpacity',
  'text-anchor':                   'textAnchor',
  'font-size':                     'fontSize',
  'font-weight':                   'fontWeight',
  'vector-effect':                 'vectorEffect',
  'shape-rendering':               'shapeRendering',
  'color-interpolation-filters':   'colorInterpolationFilters',
  'class':                         'className',
}

function toPascalCase(str: string): string {
  return str.split(/[-_\s.]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

// Monochrome UI icons: replace all hardcoded colors with currentColor so the
// icon inherits Tailwind text-* classes.
function toJsx(svg: string): string {
  let out = svg
    .replace(/<\?xml[^>]*\?>\s*/g, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace(/\s+xmlns:xlink="[^"]*"/g, '')
    .replace(/xlink:href/g, 'href')

  out = out.replace(
    /(fill|stroke)="(?!none|url\(|currentColor|transparent)([^"]*)"/g,
    '$1="currentColor"',
  )

  for (const [from, to] of Object.entries(ATTR_MAP)) {
    out = out.replace(new RegExp(`\\b${from}=`, 'g'), `${to}=`)
  }

  return out.trim()
}

// Full-color logos: only camelCase the attributes — colors are preserved as-is.
function toJsxLogo(svg: string): string {
  let out = svg
    .replace(/<\?xml[^>]*\?>\s*/g, '')
    .replace(/<!--[\s\S]*?-->\s*/g, '')
    .replace(/\s+xmlns:xlink="[^"]*"/g, '')
    .replace(/xlink:href/g, 'href')

  for (const [from, to] of Object.entries(ATTR_MAP)) {
    out = out.replace(new RegExp(`\\b${from}=`, 'g'), `${to}=`)
  }

  return out.trim()
}

function extractViewBox(svg: string): string {
  return svg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 24 24'
}

function extractInner(svg: string): string {
  return svg
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .trim()
}

function makeComponent(name: string, viewBox: string, inner: string): string {
  const indented = inner.split('\n').map(l => `      ${l}`).join('\n')
  return [
    `import type { SVGProps } from 'react'`,
    ``,
    `type Props = SVGProps<SVGSVGElement> & { size?: number }`,
    ``,
    `export function ${name}({ size = 20, ...props }: Props) {`,
    `  return (`,
    `    <svg width={size} height={size} viewBox="${viewBox}" fill="none" {...props}>`,
    indented,
    `    </svg>`,
    `  )`,
    `}`,
    ``,
  ].join('\n')
}

// Logo variant: no fill="none" override so colors render correctly.
// shapeRendering="geometricPrecision" enables sub-pixel anti-aliasing for
// smooth curves and diagonals at the small sizes logos are displayed at.
function makeLogoComponent(name: string, viewBox: string, inner: string): string {
  const indented = inner.split('\n').map(l => `      ${l}`).join('\n')
  return [
    `import type { SVGProps } from 'react'`,
    ``,
    `type Props = SVGProps<SVGSVGElement> & { size?: number }`,
    ``,
    `export function ${name}({ size = 24, ...props }: Props) {`,
    `  return (`,
    `    <svg width={size} height={size} viewBox="${viewBox}" shapeRendering="geometricPrecision" {...props}>`,
    indented,
    `    </svg>`,
    `  )`,
    `}`,
    ``,
  ].join('\n')
}

// ---------------------------------------------------------------------------

fs.mkdirSync(RAW_DIR, { recursive: true })
fs.mkdirSync(COMP_DIR, { recursive: true })
fs.mkdirSync(LOGO_RAW_DIR, { recursive: true })
fs.mkdirSync(LOGO_COMP_DIR, { recursive: true })

const svgFiles  = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.svg'))
const logoFiles = fs.readdirSync(LOGO_RAW_DIR).filter(f => f.endsWith('.svg'))

if (!svgFiles.length && !logoFiles.length) {
  console.log(`No SVG files found in ${RAW_DIR} or ${LOGO_RAW_DIR} — drop some in and re-run.`)
  process.exit(0)
}

// --- UI icons → @/generated/icons --------------------------------------------------
const iconBarrel: string[] = []

for (const file of svgFiles) {
  const name = toPascalCase(path.basename(file, '.svg'))
  const jsx  = toJsx(fs.readFileSync(path.join(RAW_DIR, file), 'utf8'))

  fs.writeFileSync(
    path.join(COMP_DIR, `${name}.tsx`),
    makeComponent(name, extractViewBox(jsx), extractInner(jsx)),
  )

  iconBarrel.push(`export { ${name} } from './components/${name}'`)
  console.log(`  ✓  ${file.padEnd(32)} → ${name}`)
}

iconBarrel.sort()
fs.writeFileSync(
  INDEX,
  `// Auto-generated by scripts/build-icons.ts — do not edit manually\n\n` +
  iconBarrel.join('\n') + '\n',
)

// --- Logos → @/generated/logos (with auto-generated registry) ----------------------
// The filename (sans .svg) IS the registry key: `NVDA.US.svg` → `'NVDA.US'`,
// `iShares.svg` → `'iShares'`. Keeping the map generated means adding a logo is
// a single step — drop the file, run the script — with no way to forget to
// register it (the class of bug a hand-maintained map invites).
const logoBarrel: string[] = []
const registryEntries: { key: string; name: string }[] = []

for (const file of logoFiles) {
  const key  = path.basename(file, '.svg') // e.g. "NVDA.US" or "iShares"
  const name = toPascalCase(key)
  const jsx  = toJsxLogo(fs.readFileSync(path.join(LOGO_RAW_DIR, file), 'utf8'))

  fs.writeFileSync(
    path.join(LOGO_COMP_DIR, `${name}.tsx`),
    makeLogoComponent(name, extractViewBox(jsx), extractInner(jsx)),
  )

  logoBarrel.push(`export { ${name} } from './components/${name}'`)
  registryEntries.push({ key, name })
  console.log(`  ✓  logos/${file.padEnd(28)} → ${name}  ['${key}']`)
}

if (logoFiles.length) {
  logoBarrel.sort()
  fs.writeFileSync(
    LOGO_INDEX,
    `// Auto-generated by scripts/build-icons.ts — do not edit manually\n\n` +
    `export { LOGO_REGISTRY } from './registry'\n` +
    logoBarrel.join('\n') + '\n',
  )

  // Keys: 'TICKER.EXCHANGE' for stocks/per-ticker ETFs, brand name for ETF providers.
  const sorted = [...registryEntries].sort((a, b) => a.key.localeCompare(b.key))
  const imports = sorted.map(e => `import { ${e.name} } from './components/${e.name}'`).join('\n')
  const pad = Math.max(...sorted.map(e => `'${e.key}':`.length))
  const rows = sorted.map(e => `  ${`'${e.key}':`.padEnd(pad)} ${e.name},`).join('\n')
  fs.writeFileSync(
    LOGO_REGISTRY,
    `// Auto-generated by scripts/build-icons.ts — do not edit manually\n` +
    `// Keys: 'TICKER.EXCHANGE' for stocks/per-ticker ETFs, brand name for ETF providers.\n\n` +
    `import type { ComponentType } from 'react'\n` +
    `${imports}\n\n` +
    `export const LOGO_REGISTRY: Record<string, ComponentType<{ size?: number }>> = {\n` +
    `${rows}\n` +
    `}\n`,
  )
}

console.log(
  `\n${svgFiles.length} icon(s) → ${INDEX}` +
  (logoFiles.length ? `\n${logoFiles.length} logo(s) → ${LOGO_INDEX} (+ registry)` : ''),
)
