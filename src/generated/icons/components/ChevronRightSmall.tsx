import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ChevronRightSmall({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M10 8L13.3059 11.2929C13.698 11.6834 13.698 12.3166 13.3059 12.7071L10 16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
