import { useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EditSmall, Trash } from '@/generated/icons'
import { useSettings } from '@/context/SettingsContext'

export function AccountSettingsPage() {
  const { userName, userAvatar, updateUserName, updateUserAvatar } = useSettings()
  const [nameValue, setNameValue] = useState(userName ?? '')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initials = userName ? userName.slice(0, 2).toUpperCase() : undefined
  const avatarVariant = userAvatar ? 'image' : initials ? 'initials' : 'icon'

  function handleNameBlur() {
    updateUserName(nameValue)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => updateUserAvatar(reader.result as string)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="w-full h-full bg-surface rounded-lg shadow-[0px_8px_16px_-4px_rgba(10,10,10,0.05)] p-6 flex flex-col items-center justify-center gap-8 overflow-y-auto scrollbar-none">
      {/* Avatar with flanking buttons, revealed on hover */}
      <div className="group flex items-center gap-4">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <Button
            variant="secondary"
            iconPosition="only"
            icon={EditSmall}
            onClick={() => fileInputRef.current?.click()}
          />
        </div>

        <Avatar
          size="xl"
          variant={avatarVariant}
          initials={initials}
          src={userAvatar}
        />

        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <Button
            variant="secondary"
            iconPosition="only"
            icon={Trash}
            onClick={() => updateUserAvatar(undefined)}
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Connected form rows */}
      <div className="w-full max-w-xs rounded-lg overflow-hidden">
        {/* Name row */}
        <div className="flex items-center gap-3 px-4 h-14 bg-muted border-b border-surface">
          <span className="text-sm font-medium text-foregroundMuted tracking-[-0.35px] whitespace-nowrap">
            What's your name?
          </span>
          <input
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleNameBlur}
            placeholder="Add your name"
            className="flex-1 min-w-0 bg-transparent outline-none text-foreground text-sm font-medium tracking-[-0.35px] text-right placeholder:text-accent"
          />
        </div>

        {/* Risk profile row */}
        <div className="flex items-center gap-3 px-4 h-14 bg-muted">
          <span className="flex-1 text-sm font-medium text-foregroundMuted tracking-[-0.35px]">
            Investor risk profile
          </span>
          <Badge variant="blue">Coming Soon</Badge>
        </div>
      </div>
    </div>
  )
}
