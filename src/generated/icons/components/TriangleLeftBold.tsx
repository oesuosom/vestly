import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function TriangleLeftBold({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M13.0122 8.14664C13.9248 7.69047 14.9991 8.35379 14.9991 9.37432V14.6257C14.9991 15.6462 13.9248 16.3095 13.0122 15.8534L8.75898 13.2277C7.747 12.7219 7.74701 11.2781 8.75898 10.7723L13.0122 8.14664Z" fill="currentColor"/>
    </svg>
  )
}
