import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  parent?: { name: string; to: string }
  action?: ReactNode
}

export function PageHeader({ title, parent, action }: PageHeaderProps) {
  return (
    <div className="flex justify-between items-center mb-8 h-9">
      <div className="flex items-center gap-1 min-w-0 flex-1">
        {parent && (
          <>
            <Link
              to={parent.to}
              className="text-sm font-semibold tracking-tight text-accent hover:text-foreground transition-colors shrink-0 whitespace-nowrap"
            >
              {parent.name}
            </Link>
            <span className="text-sm font-semibold tracking-tight text-accent shrink-0">/</span>
          </>
        )}
        <span className="text-sm font-semibold tracking-tight text-foreground truncate">
          {title}
        </span>
      </div>
      {action && (
        <div className="flex items-center gap-3 shrink-0">
          {action}
        </div>
      )}
    </div>
  )
}
