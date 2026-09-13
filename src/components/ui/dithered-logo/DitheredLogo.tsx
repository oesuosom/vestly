import { useEffect, useRef } from 'react'
import logoSvgRaw from '@/assets/logo.svg?raw'

export type DitheredLogoStyle = 'halftone' | 'fine' | 'diffuse'

export type DitheredLogoProps = {
  /** Rendered size in CSS pixels (square). Internal render resolution is fixed at 480. */
  size?: number
  /** Raw SVG markup to dither. Defaults to the Vestly logomark. */
  svg?: string
  style?: DitheredLogoStyle
  /** Repulsion zone radius, in internal canvas px (0–480 grid). */
  pushRadius?: number
  /** Max dot displacement at cursor center, in internal canvas px. */
  maxDisp?: number
  /** Dot coverage fraction, 0–1. */
  density?: number
  /** Bayer tile scale, 1–4. */
  dotScale?: number
  /** CSS custom property used for the dots (halftone/fine) or ink (diffuse). */
  foregroundVar?: string
  /** CSS custom property used for the fill in `diffuse` style (unused by halftone/fine, which are transparent). */
  backgroundVar?: string
  className?: string
}

const RESOLUTION = 480
const PADDING = 80
const OFF_CANVAS = -1000

const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16))

const BAYER_8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
].map((row) => row.map((v) => (v + 0.5) / 64))

function toMonochromeMask(svg: string) {
  return svg
    .replace(/fill="(?!none)[^"]+"/g, 'fill="black"')
    .replace(/fill='(?!none)[^']+'/g, "fill='black'")
    .replace(/stroke="(?!none)[^"]+"/g, 'stroke="black"')
    .replace(/stroke='(?!none)[^']+'/g, "stroke='black'")
}

/** Resolves a CSS custom property (any color syntax) to an RGB triplet via a 1x1 canvas probe. */
function resolveCssColor(
  probeCtx: CanvasRenderingContext2D,
  varName: string,
  fallback: string,
): [number, number, number] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  probeCtx.fillStyle = value || fallback
  probeCtx.fillRect(0, 0, 1, 1)
  const data = probeCtx.getImageData(0, 0, 1, 1).data
  return [data[0], data[1], data[2]]
}

/**
 * Interactive dithered/halftone rendering of a logo mark. Dots repel from the
 * cursor within `pushRadius`. Background/foreground colors track the
 * `--color-background` / `--color-foreground` design tokens (incl. theme
 * changes via the `dark` class on <html>). Halftone/fine styles render on a
 * transparent background so this drops into any container; diffuse style
 * dithers the full canvas and stays opaque.
 */
export function DitheredLogo({
  size = 160,
  svg = logoSvgRaw,
  style = 'halftone',
  pushRadius = 112,
  maxDisp = 48,
  density = 0.2,
  dotScale = 2,
  foregroundVar = '--color-accent',
  backgroundVar = '--color-background',
  className,
}: DitheredLogoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const configRef = useRef({ style, pushRadius, maxDisp, density, dotScale, foregroundVar, backgroundVar })

  useEffect(() => {
    configRef.current = { style, pushRadius, maxDisp, density, dotScale, foregroundVar, backgroundVar }
  }, [style, pushRadius, maxDisp, density, dotScale, foregroundVar, backgroundVar])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const probeCtx = document.createElement('canvas').getContext('2d')
    if (!canvas || !ctx || !probeCtx) return

    let mask: Float32Array | null = null
    let bgColor: [number, number, number] = [255, 255, 255]
    let fgColor: [number, number, number] = [0, 0, 0]
    const mouseTarget = { x: OFF_CANVAS, y: OFF_CANVAS }
    const mouseSmooth = { x: OFF_CANVAS, y: OFF_CANVAS }
    let rafId = 0
    let cancelled = false

    const readColors = () => {
      bgColor = resolveCssColor(probeCtx, configRef.current.backgroundVar, '#ffffff')
      fgColor = resolveCssColor(probeCtx, configRef.current.foregroundVar, '#000000')
    }
    readColors()

    const themeObserver = new MutationObserver(readColors)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const mono = toMonochromeMask(svg)
    const blob = new Blob([mono], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      const off = document.createElement('canvas')
      off.width = RESOLUTION
      off.height = RESOLUTION
      const offCtx = off.getContext('2d')
      if (!offCtx) return
      offCtx.drawImage(img, PADDING, PADDING, RESOLUTION - PADDING * 2, RESOLUTION - PADDING * 2)
      const { data } = offCtx.getImageData(0, 0, RESOLUTION, RESOLUTION)
      const m = new Float32Array(RESOLUTION * RESOLUTION)
      for (let i = 0; i < RESOLUTION * RESOLUTION; i++) m[i] = data[i * 4 + 3] / 255
      mask = m
      URL.revokeObjectURL(url)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url

    const imgData = ctx.createImageData(RESOLUTION, RESOLUTION)
    const od = imgData.data
    const grayBuf = new Float32Array(RESOLUTION * RESOLUTION)

    const frame = () => {
      if (cancelled) return
      if (!mask) {
        rafId = requestAnimationFrame(frame)
        return
      }

      mouseSmooth.x += (mouseTarget.x - mouseSmooth.x) * 0.15
      mouseSmooth.y += (mouseTarget.y - mouseSmooth.y) * 0.15
      const mx = mouseSmooth.x
      const my = mouseSmooth.y

      const cfg = configRef.current
      const pushRSq = cfg.pushRadius * cfg.pushRadius
      const sigma2 = pushRSq * 0.5
      const maxD = cfg.maxDisp
      const den = cfg.density
      const ds = Math.max(1, Math.round(cfg.dotScale))
      const dotThreshold = 1 - den

      const [bgR, bgG, bgB] = bgColor
      const [fgR, fgG, fgB] = fgColor

      if (cfg.style === 'diffuse') {
        const baseBrightness = 1 - den
        for (let y = 0; y < RESOLUTION; y++) {
          for (let x = 0; x < RESOLUTION; x++) {
            const i = y * RESOLUTION + x
            const alpha = mask[i]
            const dx = x - mx
            const dy = y - my
            const distSq = dx * dx + dy * dy
            const push = distSq < pushRSq * 4 ? Math.exp(-distSq / sigma2) : 0
            const logoGray = baseBrightness + push * (1 - baseBrightness)
            grayBuf[i] = logoGray * alpha + 1 * (1 - alpha)
          }
        }
        for (let y = 0; y < RESOLUTION; y++) {
          for (let x = 0; x < RESOLUTION; x++) {
            const i = y * RESOLUTION + x
            const old = Math.max(0, Math.min(1, grayBuf[i]))
            const nv = old > 0.5 ? 1 : 0
            const err = old - nv
            grayBuf[i] = nv
            if (x + 1 < RESOLUTION) grayBuf[i + 1] += err * (7 / 16)
            if (y + 1 < RESOLUTION) {
              if (x > 0) grayBuf[i + RESOLUTION - 1] += err * (3 / 16)
              grayBuf[i + RESOLUTION] += err * (5 / 16)
              if (x + 1 < RESOLUTION) grayBuf[i + RESOLUTION + 1] += err * (1 / 16)
            }
          }
        }
        for (let i = 0; i < RESOLUTION * RESOLUTION; i++) {
          const p = i * 4
          const isFg = grayBuf[i] < 0.5
          od[p] = isFg ? fgR : bgR
          od[p + 1] = isFg ? fgG : bgG
          od[p + 2] = isFg ? fgB : bgB
          od[p + 3] = 255
        }
      } else {
        od.fill(0) // transparent outside the dithered dots

        const mat = cfg.style === 'halftone' ? BAYER_8 : BAYER_4
        const ms2 = mat.length

        for (let sy = 0; sy < RESOLUTION; sy++) {
          for (let sx = 0; sx < RESOLUTION; sx++) {
            if (mask[sy * RESOLUTION + sx] < 0.5) continue

            const by = Math.floor(sy / ds) % ms2
            const bx = Math.floor(sx / ds) % ms2

            const dx = sx - mx
            const dy = sy - my
            const distSq = dx * dx + dy * dy
            const gaussFalloff = distSq < pushRSq * 4 ? Math.exp(-distSq / sigma2) : 0

            let thresh = mat[by][bx]
            if (gaussFalloff > 0.005) {
              const n = Math.sin(sx * 127.1 + sy * 311.7) * 43758.5453
              thresh += gaussFalloff * (n - Math.floor(n) - thresh)
            }
            if (thresh <= dotThreshold) continue

            let ox = sx
            let oy = sy
            if (gaussFalloff > 0.005) {
              const dist = Math.sqrt(distSq) || 1
              const strength = maxD * gaussFalloff
              ox = Math.round(sx + (dx / dist) * strength)
              oy = Math.round(sy + (dy / dist) * strength)
              ox = Math.max(0, Math.min(RESOLUTION - 1, ox))
              oy = Math.max(0, Math.min(RESOLUTION - 1, oy))
            }

            const p = (oy * RESOLUTION + ox) * 4
            od[p] = fgR
            od[p + 1] = fgG
            od[p + 2] = fgB
            od[p + 3] = 255
          }
        }
      }

      ctx.putImageData(imgData, 0, 0)
      rafId = requestAnimationFrame(frame)
    }
    rafId = requestAnimationFrame(frame)

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouseTarget.x = (e.clientX - rect.left) * (RESOLUTION / rect.width)
      mouseTarget.y = (e.clientY - rect.top) * (RESOLUTION / rect.height)
    }
    const handleMouseEnter = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const x = (e.clientX - rect.left) * (RESOLUTION / rect.width)
      const y = (e.clientY - rect.top) * (RESOLUTION / rect.height)
      mouseTarget.x = x
      mouseTarget.y = y
      mouseSmooth.x = x
      mouseSmooth.y = y
    }
    const handleMouseLeave = () => {
      mouseTarget.x = OFF_CANVAS
      mouseTarget.y = OFF_CANVAS
    }

    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseenter', handleMouseEnter)
    canvas.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
      themeObserver.disconnect()
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('mouseenter', handleMouseEnter)
      canvas.removeEventListener('mouseleave', handleMouseLeave)
      URL.revokeObjectURL(url)
    }
  }, [svg])

  return (
    <canvas
      ref={canvasRef}
      width={RESOLUTION}
      height={RESOLUTION}
      className={className}
      style={{ width: size, height: size, cursor: 'crosshair' }}
    />
  )
}
