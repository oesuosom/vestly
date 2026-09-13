import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function SidebarLeftBold({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M22 7.75C22 5.67893 20.3211 4 18.25 4H5.75C3.67893 4 2 5.67893 2 7.75V16.25C2 18.3211 3.67893 20 5.75 20H18.25C20.3211 20 22 18.3211 22 16.25V7.75ZM5.75 16V8C5.75 7.51675 6.14175 7.125 6.625 7.125C7.10825 7.125 7.5 7.51675 7.5 8V16C7.5 16.4832 7.10825 16.875 6.625 16.875C6.14175 16.875 5.75 16.4832 5.75 16Z" fill="currentColor"/>
    </svg>
  )
}
