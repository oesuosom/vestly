import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function HomeBold({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path fillRule="evenodd" clipRule="evenodd" d="M9.62536 2.22364C11.0067 1.09342 12.9933 1.09343 14.3746 2.22364L19.6246 6.5191C20.4952 7.23133 21 8.29669 21 9.42144V17.2498C21 19.3208 19.3211 20.9998 17.25 20.9998H6.75C4.67893 20.9998 3 19.3208 3 17.2498V9.42144C3 8.29669 3.50485 7.23133 4.37536 6.5191L9.62536 2.22364Z" fill="currentColor"/>
    </svg>
  )
}
