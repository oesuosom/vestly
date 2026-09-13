import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function ToggleBold({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M23 12C23 16.4183 19.4183 20 15 20H9C4.58172 20 1 16.4183 1 12C1 7.58172 4.58172 4 9 4H15C19.4183 4 23 7.58172 23 12ZM15 15.5C16.9331 15.5 18.5 13.9331 18.5 12C18.5 10.0669 16.9331 8.5 15 8.5C13.0669 8.5 11.5 10.0669 11.5 12C11.5 13.9331 13.0669 15.5 15 15.5Z" fill="currentColor"/>
    </svg>
  )
}
