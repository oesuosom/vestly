import type { ComponentType } from 'react'
import type { AccountType } from '@/types'
import {
  AnonymousBold, CreditCardBold, ChartBold, CoinsBold, CurrencyCryptoBold, PaletteBold, FolderOpenedBold,
  GlobeBold, GraduateCapBold, HeartBold, KeyholeBold, PlaneBold, ReceiptBillBold,
  PersonArmsBold, VaultBold, ShieldBold, WindRoseBold, SparkleBold,
  SuitcaseBold, TargetBold, Wallet1Bold, Wallet2Bold, Wallet3Bold, ZapBold,
} from '@/generated/icons'

// These live outside AccountIcon.tsx so that file exports components only —
// mixing constants in breaks React Fast Refresh for the component.

export type IconComponent = ComponentType<{ size?: number }>

// iconId values stored on Account — kebab-case of the icon component name.
// Renaming a key requires an entry in ICON_ID_RENAMES so stored data migrates.
export const ACCOUNT_ICON_REGISTRY: Record<string, IconComponent> = {
  'anonymous':     AnonymousBold,
  'credit-card':   CreditCardBold,
  'chart':         ChartBold,
  'currency-crypto': CurrencyCryptoBold,
  'coins':         CoinsBold,
  'palette':       PaletteBold,
  'folder-opened': FolderOpenedBold,
  'globe':         GlobeBold,
  'graduate-cap':  GraduateCapBold,
  'heart':         HeartBold,
  'keyhole':       KeyholeBold,
  'plane':         PlaneBold,
  'receipt-bill':  ReceiptBillBold,
  'person-arms':   PersonArmsBold,
  'vault':         VaultBold,
  'shield':        ShieldBold,
  'wind-rose':     WindRoseBold,
  'sparkle':       SparkleBold,
  'suitcase':      SuitcaseBold,
  'target':        TargetBold,
  'wallet-1':      Wallet1Bold,
  'wallet-2':      Wallet2Bold,
  'wallet-3':      Wallet3Bold,
  'zap':           ZapBold,
}

export const TYPE_DEFAULTS: Record<AccountType, IconComponent> = {
  brokerage: CoinsBold,
  ike:       Wallet2Bold,
  ikze:      Wallet1Bold,
  crypto:    CurrencyCryptoBold,
  savings:   VaultBold,
}

export const TYPE_COLORS: Record<AccountType, { bg: string; icon: string }> = {
  ike:       { bg: 'var(--color-blue-foreground)',   icon: 'var(--color-blue)'   },
  ikze:      { bg: 'var(--color-purple-foreground)', icon: 'var(--color-purple)' },
  brokerage: { bg: 'var(--color-teal-foreground)',   icon: 'var(--color-teal)'   },
  crypto:    { bg: 'var(--color-orange-foreground)', icon: 'var(--color-orange)' },
  savings:   { bg: 'var(--color-lime-foreground)',   icon: 'var(--color-lime)'   },
}
