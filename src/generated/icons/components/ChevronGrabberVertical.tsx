import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ChevronGrabberVertical({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M16 15L12.7071 18.2929C12.3166 18.6834 11.6834 18.6834 11.2929 18.2929L8 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M8 8.99985L11.2929 5.70696C11.6834 5.31643 12.3166 5.31643 12.7071 5.70696L16 8.99985" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
