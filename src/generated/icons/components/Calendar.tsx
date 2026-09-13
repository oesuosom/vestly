import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function Calendar({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M7.75 4.75V2.75M16.25 4.75V2.75M7.75 8.75H16.25M3.75 7.75C3.75 6.09315 5.09315 4.75 6.75 4.75H17.25C18.9069 4.75 20.25 6.09315 20.25 7.75V17.25C20.25 18.9069 18.9069 20.25 17.25 20.25H6.75C5.09315 20.25 3.75 18.9069 3.75 17.25V7.75Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  )
}
