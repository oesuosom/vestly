import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function Loader({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 3V6M18.3638 5.63625L16.2422 7.75781M21 12H18M18.3638 18.3638L16.2422 16.2422M12 21V18M5.63625 18.3638L7.75781 16.2422M3 12H6M5.63625 5.63625L7.75781 7.75781" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
