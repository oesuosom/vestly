import React from 'react'

type StatCardGroupProps = {
  children: React.ReactNode
}

export function StatCardGroup({ children }: StatCardGroupProps) {
  const cards = React.Children.toArray(children)

  return (
    <div className="flex items-center bg-surface border border-borderLight rounded-xl overflow-hidden">
      {cards.map((card, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <div className="self-stretch flex items-center shrink-0">
              <div className="w-px h-8 bg-border" />
            </div>
          )}
          <div className="flex-1 min-w-0">{card}</div>
        </React.Fragment>
      ))}
    </div>
  )
}
