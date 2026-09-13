import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ClockBold({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 21.5C17.2467 21.5 21.5 17.2467 21.5 12C21.5 6.75329 17.2467 2.5 12 2.5C6.75329 2.5 2.5 6.75329 2.5 12C2.5 17.2467 6.75329 21.5 12 21.5ZM11 7.2002C11 6.64791 11.4477 6.2002 12 6.2002C12.5523 6.2002 13 6.64791 13 7.2002V11.5859L15.207 13.793C15.5975 14.1835 15.5975 14.8165 15.207 15.207C14.8165 15.5976 14.1835 15.5976 13.793 15.207L11.293 12.707C11.1055 12.5195 11 12.2652 11 12V7.2002Z" fill="currentColor"/>
    </svg>
  )
}
