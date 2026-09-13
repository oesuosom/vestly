import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function KeyholeBold({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12ZM9 10C9 8.34315 10.3431 7 12 7C13.6569 7 15 8.34315 15 10C15 10.8885 14.6137 11.6868 14 12.2361V15C14 16.1046 13.1046 17 12 17C10.8954 17 10 16.1046 10 15V12.2361C9.38625 11.6868 9 10.8885 9 10Z" fill="currentColor"/>
    </svg>
  )
}
