import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ColumnWideHalf({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M3 12H21M7 19.5H17C19.2091 19.5 21 17.7091 21 15.5V8.5C21 6.29086 19.2091 4.5 17 4.5H7C4.79086 4.5 3 6.29086 3 8.5V15.5C3 17.7091 4.79086 19.5 7 19.5Z" stroke="currentColor" strokeWidth="1.75"/>
    </svg>
  )
}
