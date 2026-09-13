import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function CircleDashed({ size = 20, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" {...props}>
      <path d="M10.29 3.16394C11.4195 2.94535 12.5804 2.94535 13.7099 3.16394M13.7099 20.8361C12.5804 21.0546 11.4195 21.0546 10.29 20.8361M17.048 4.54907C18.0033 5.19637 18.8252 6.02135 19.469 6.97907M3.16394 13.7101C2.94535 12.5806 2.94535 11.4196 3.16394 10.2901M19.451 17.048C18.8037 18.0033 17.9787 18.8252 17.021 19.469M20.8361 10.2901C21.0546 11.4196 21.0546 12.5806 20.8361 13.7101M4.54894 6.95205C5.19623 5.99673 6.0212 5.1748 6.97891 4.53105M6.952 19.4512C5.99669 18.8039 5.17478 17.9789 4.53103 17.0212" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
