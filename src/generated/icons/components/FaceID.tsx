import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function FaceID({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M5.75 17.5C9.9491 21.1667 14.0509 21.1667 18.25 17.5M12.75 5.75V12.25C12.75 13.3546 11.8546 14.25 10.75 14.25M4.75 4.75V8.25M19.25 4.75V8.25" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
