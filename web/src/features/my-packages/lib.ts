/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { nanoid } from 'nanoid'

import { quotaUnitsToEditableAmount } from '@/lib/format'

import type {
  PackageChannelBinding,
  PackageVersion,
  TokenPackage,
  UserChannel,
} from '../token-package/types'

export const CREATED_PACKAGES_QUERY_KEY = ['my-packages', 'created'] as const
export const MY_PACKAGE_CHANNELS_QUERY_KEY = [
  'my-packages',
  'channels',
] as const
export const PURCHASED_PACKAGES_QUERY_KEY = [
  'my-packages',
  'purchased',
] as const

export const MAX_PACKAGE_MODELS = 50
export const MAX_PACKAGE_TIERS = 10
export const MAX_PACKAGE_CHANNELS = 10

export type TierFormValue = {
  skuKey: string
  title: string
  price: string
  credit: string
  validDays: string
}

export type ModelFormValue = {
  model: string
  multiplier: string
}

export type PackageEditorValues = {
  title: string
  subtitle: string
  tiers: TierFormValue[]
  models: ModelFormValue[]
  channelIds: number[]
}

export type PackageOffer = {
  tierCount: number
  minPrice: number
  maxCredit: number
  minValidDays: number
  maxValidDays: number
}

export type StatusBadgeVariant =
  | 'default'
  | 'secondary'
  | 'destructive'
  | 'warning'
  | 'success'
  | 'info'
  | 'outline'

export function packageStatusVariant(status: string): StatusBadgeVariant {
  switch (status) {
    case 'listed':
      return 'success'
    case 'paused':
      return 'warning'
    case 'terminated':
      return 'destructive'
    case 'draft':
      return 'outline'
    default:
      return 'secondary'
  }
}

export function versionStatusVariant(status: string): StatusBadgeVariant {
  switch (status) {
    case 'approved':
      return 'success'
    case 'pending_review':
      return 'warning'
    case 'rejected':
      return 'destructive'
    case 'testing':
      return 'info'
    default:
      return 'secondary'
  }
}

export function createBlankTier(): TierFormValue {
  return {
    skuKey: `tier_${nanoid(10)}`,
    title: '',
    price: '',
    credit: '',
    validDays: '30',
  }
}

export function versionForEditing(
  packageData: TokenPackage | null
): PackageVersion | null {
  if (!packageData) return null

  const latest = packageData.latest_version
  if (
    latest &&
    (latest.status === 'draft' || latest.status === 'rejected') &&
    (latest.models?.length || latest.skus?.length)
  ) {
    return latest
  }
  return packageData.active_version || latest || null
}

export function buildPackageEditorValues(
  packageData: TokenPackage | null,
  channels: UserChannel[]
): PackageEditorValues {
  const source = versionForEditing(packageData)
  const tiers = (source?.skus || []).map((sku) => ({
    skuKey: sku.sku_key,
    title: sku.title,
    price: String(quotaUnitsToEditableAmount(sku.price_quota)),
    credit: String(quotaUnitsToEditableAmount(sku.credit_quota)),
    validDays: String(sku.valid_days),
  }))
  const sourceChannels = source?.channels || []
  const usableChannelIds = new Set(
    channels
      .filter(
        (channel) =>
          isChannelEnabled(channel) && (channel.models || []).length > 0
      )
      .map((channel) => channel.id)
  )

  return {
    title: packageData?.title || '',
    subtitle: packageData?.subtitle || '',
    tiers: tiers.length > 0 ? tiers : [createBlankTier()],
    models: (source?.models || []).map((spec) => ({
      model: spec.model,
      multiplier: String(spec.multiplier),
    })),
    channelIds: [
      ...new Set(
        sourceChannels
          .map((binding) => binding.channel_id)
          .filter((channelId) => usableChannelIds.has(channelId))
      ),
    ],
  }
}

export function packageOffer(version?: PackageVersion | null): PackageOffer {
  const skus = version?.skus || []
  if (skus.length === 0) {
    return {
      tierCount: 0,
      minPrice: 0,
      maxCredit: 0,
      minValidDays: 0,
      maxValidDays: 0,
    }
  }

  const prices = skus.map((sku) => sku.price_quota)
  const credits = skus.map((sku) => sku.credit_quota)
  const validDays = skus.map((sku) => sku.valid_days)
  return {
    tierCount: skus.length,
    minPrice: Math.min(...prices),
    maxCredit: Math.max(...credits),
    minValidDays: Math.min(...validDays),
    maxValidDays: Math.max(...validDays),
  }
}

export function isChannelEnabled(channel: UserChannel): boolean {
  return channel.status === 1
}

export function channelsForModel(
  channels: UserChannel[],
  model: string,
  channelIds: number[]
): UserChannel[] {
  const selected = new Set(channelIds)
  return channels.filter(
    (channel) =>
      isChannelEnabled(channel) &&
      selected.has(channel.id) &&
      (channel.models || []).includes(model)
  )
}

export function buildChannelBindings(
  channels: UserChannel[],
  models: string[],
  channelIds: number[],
  sourceBindings: PackageChannelBinding[]
): PackageChannelBinding[] {
  const selected = new Set(channelIds)
  const sourceByChannel = new Map(
    sourceBindings.map((binding) => [binding.channel_id, binding])
  )

  return channels
    .filter((channel) => isChannelEnabled(channel) && selected.has(channel.id))
    .map((channel) => {
      const servedModels = (channel.models || []).filter((model) =>
        models.includes(model)
      )
      const source = sourceByChannel.get(channel.id)
      return {
        channel_id: channel.id,
        models: servedModels,
        priority: source?.priority ?? 0,
        weight: source?.weight ?? 1,
      }
    })
    .filter((binding) => binding.models.length > 0)
}
