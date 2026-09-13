import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ArrowUpSquare({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M12 16V8M15 11L12 8L9 11M17.4091 3.5H6.59091C4.88385 3.5 3.5 4.88385 3.5 6.59091V17.4091C3.5 19.1162 4.88385 20.5 6.59091 20.5H17.4091C19.1162 20.5 20.5 19.1162 20.5 17.4091V6.59091C20.5 4.88385 19.1162 3.5 17.4091 3.5Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
