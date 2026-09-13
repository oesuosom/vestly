import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { size?: number }

export function CRIPL({ size = 24, ...props }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" shapeRendering="geometricPrecision" {...props}>
      <g clipPath="url(#clip0_185_1033)">
      <rect width="24" height="24" fill="#0F1CFF"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M11.9982 19.0247C8.12829 19.0247 5 15.8928 5 12.0184C5 8.14308 8.12829 5.01117 11.9982 5.01117C15.8681 5.01117 18.9964 8.14308 18.9964 12.0184C18.9964 15.8928 15.8681 19.0247 11.9982 19.0247ZM18.0667 12.0184C18.0667 8.6613 15.3553 5.94722 12.0009 5.94722C8.64742 5.94722 5.93605 8.6613 5.93605 12.0184C5.93605 15.3755 8.64742 18.0896 12.0009 18.0896C15.3553 18.0896 18.0667 15.3755 18.0667 12.0184Z" fill="white"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M10.1297 11.0878V15.4515L8.16266 17.9141L7.43553 17.3335L9.2 15.1241V11.0878H10.1297Z" fill="white"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M14.3297 13.422V9.05288L16.3022 6.58931L17.0293 7.17626L15.2649 9.38027V13.422H14.3297Z" fill="white"/>
      <path d="M9.66487 11.5499C8.8898 11.5499 8.26396 10.9241 8.26396 10.1499C8.26396 9.37488 8.8898 8.74904 9.66487 8.74904C10.439 8.74904 11.0658 9.37488 11.0658 10.1499C11.0658 10.9241 10.439 11.5499 9.66487 11.5499Z" fill="white"/>
      <path d="M14.8 15.7554C14.0249 15.7554 13.3991 15.1295 13.3991 14.3545C13.3991 13.5803 14.0249 12.9536 14.8 12.9536C15.5742 12.9536 16.2009 13.5803 16.2009 14.3545C16.2009 15.1295 15.5742 15.7554 14.8 15.7554Z" fill="white"/>
      </g>
      <defs>
      <clipPath id="clip0_185_1033">
      <rect width="24" height="24" fill="white"/>
      </clipPath>
      </defs>
    </svg>
  )
}
