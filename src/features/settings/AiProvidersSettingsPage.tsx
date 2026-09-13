import { useState } from 'react'
import anthropicIcon from '@/assets/providers/anthropic.png'
import { ChevronTopSmall, Eye, Nut } from '@/generated/icons'
import { Button } from '@/components/ui/Button'
import { Toggle } from '@/components/ui/Toggle'
import { useSettings } from '@/context/SettingsContext'

type ProviderRowProps = {
  icon: string
  name: string
  description: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
  apiKeyMissing: boolean
  isExpanded: boolean
  onToggleExpand: () => void
}

function ProviderRow({
  icon,
  name,
  description,
  enabled,
  onToggle,
  apiKeyMissing,
  isExpanded,
  onToggleExpand,
}: ProviderRowProps) {
  return (
    <div className="flex items-center gap-3 h-14 p-3 bg-muted border-b border-surface shrink-0">
      <img src={icon} alt={name} className="size-8 rounded-lg object-cover shrink-0" />
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <span className="text-sm font-medium text-foreground tracking-[-0.35px] leading-none">{name}</span>
        <span className="text-xs text-foregroundMuted tracking-[-0.3px] truncate leading-none">
          {apiKeyMissing && !enabled ? 'Add an API key to enable this provider.' : description}
        </span>
      </div>
      <div className="flex items-center gap-3 pr-1 shrink-0">
        <Button
          variant="ghost"
          iconPosition="only"
          icon={isExpanded ? ChevronTopSmall : Nut}
          onClick={onToggleExpand}
        />
        <Toggle checked={enabled} onChange={onToggle} disabled={apiKeyMissing && !enabled} />
      </div>
    </div>
  )
}

type ApiKeyRowProps = {
  savedKey: string
  onSave: (key: string) => void
}

function ApiKeyRow({ savedKey, onSave }: ApiKeyRowProps) {
  const [value, setValue] = useState(savedKey)
  const [showKey, setShowKey] = useState(false)
  const isDirty = value !== savedKey

  return (
    <div className="flex items-center gap-3 h-14 pl-4 pr-3 py-3 bg-muted shrink-0">
      <input
        type={showKey ? 'text' : 'password'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Enter API Key"
        className="flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground tracking-[-0.35px] placeholder:text-accent outline-none"
      />
      <div className="flex items-center gap-3 pr-1 shrink-0">
        <Button
          variant="ghost"
          iconPosition="only"
          icon={Eye}
          onClick={() => setShowKey((v) => !v)}
        />
        <button
          onClick={() => isDirty && onSave(value)}
          className={`w-10 text-sm font-semibold text-foreground tracking-[-0.35px] transition-opacity ${isDirty ? 'opacity-100 cursor-pointer' : 'opacity-50 cursor-default'}`}
        >
          Save
        </button>
      </div>
    </div>
  )
}

export function AiProvidersSettingsPage() {
  const { claudeApiKey, anthropicEnabled, updateClaudeApiKey, updateAnthropicEnabled } = useSettings()
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="flex flex-col gap-6 h-full overflow-y-auto scrollbar-none p-6 bg-surface rounded-lg shadow-[0px_8px_16px_-4px_rgba(10,10,10,0.05)]">
      <div className="flex flex-col gap-0 shrink-0">
        <div className="flex items-center h-9">
          <h2 className="flex-1 text-[18px] font-medium text-foreground tracking-[-0.45px] leading-none">
            AI Providers
          </h2>
        </div>
        <p className="text-sm text-foregroundMuted tracking-[-0.35px] leading-none">
          Configure AI providers for portfolio insights.
        </p>
      </div>

      <div className="flex flex-col gap-4 shrink-0">
        <div className="flex flex-col rounded-lg overflow-clip">
          <ProviderRow
            icon={anthropicIcon}
            name="Anthropic"
            description="Claude AI models from Anthropic"
            enabled={anthropicEnabled}
            onToggle={updateAnthropicEnabled}
            apiKeyMissing={!claudeApiKey}
            isExpanded={isExpanded}
            onToggleExpand={() => setIsExpanded((v) => !v)}
          />
          {isExpanded && (
            <ApiKeyRow savedKey={claudeApiKey} onSave={updateClaudeApiKey} />
          )}
        </div>
      </div>

      <div className="flex flex-col rounded-lg overflow-clip shrink-0">
        <div className="bg-[#e1e4fe] p-4">
          <p className="text-sm text-[#5d42c7] tracking-[-0.35px] leading-relaxed">
            Generates AI portfolio summaries on the overview page. Only Haiku is used — very low cost (~$0.01 per summary).
          </p>
        </div>
      </div>
    </div>
  )
}
