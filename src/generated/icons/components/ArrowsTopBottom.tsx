import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ArrowsTopBottom({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M10.5 7.99996L7.75258 4.86005C7.35416 4.40472 6.64583 4.40472 6.24742 4.86005L3.5 7.99996M7 19L7 4.99996M13.5 16L16.2474 19.1399C16.6458 19.5952 17.3542 19.5952 17.7526 19.1399L20.5 16M17 4.99996V19" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
