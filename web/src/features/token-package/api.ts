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

import { api } from '@/lib/api'

import type {
  PackageEntitlement,
  PackageOrder,
  PackageVersion,
  PendingReview,
  SellerLedgerEntry,
  SellerRevenueSummary,
  SellerStatus,
  TokenPackage,
  UserChannel,
  VerificationStatus,
  AdminVerification,
} from './types'

export async function fetchMarketPackages(params: {
  page: number
  pageSize: number
  keyword?: string
  model?: string
}) {
  const res = await api.get('/api/market/packages', {
    params: {
      p: params.page,
      page_size: params.pageSize,
      keyword: params.keyword || undefined,
      model: params.model || undefined,
    },
  })
  return res.data as {
    success: boolean
    message?: string
    data?: {
      items: TokenPackage[]
      total: number
      page: number
      page_size: number
    }
  }
}

export async function fetchMarketPackage(id: number) {
  const res = await api.get(`/api/market/packages/${id}`)
  return res.data as { success: boolean; message?: string; data?: TokenPackage }
}

/** Returned by a purchase the server refused because the buyer is not verified. */
export const PACKAGE_BUYER_UNVERIFIED_CODE = 'PACKAGE_BUYER_UNVERIFIED'

export async function purchasePackage(id: number, skuKey: string) {
  const res = await api.post(`/api/market/packages/${id}/purchase`, {
    sku_key: skuKey,
  })
  return res.data as {
    success: boolean
    message?: string
    code?: string
    data?: { order: PackageOrder; entitlement: PackageEntitlement }
  }
}

export async function fetchMyEntitlements() {
  const res = await api.get('/api/user/package-entitlements')
  return res.data as {
    success: boolean
    message?: string
    data?: PackageEntitlement[]
  }
}

export async function fetchSellerStatus() {
  const res = await api.get('/api/seller/status')
  return res.data as { success: boolean; message?: string; data?: SellerStatus }
}

export async function fetchMyVerification() {
  const res = await api.get('/api/user/verification')
  return res.data as {
    success: boolean
    message?: string
    data?: VerificationStatus
  }
}

export async function submitVerification(
  payload: {
    real_name: string
    id_number: string
    consent: boolean
    consent_version: string
  },
  proofToken: string
) {
  const res = await api.post('/api/user/verification', payload, {
    headers: { 'X-Security-Proof': proofToken },
  })
  return res.data as { success: boolean; message?: string }
}

export async function fetchSellerPackages() {
  const res = await api.get('/api/seller/packages')
  return res.data as {
    success: boolean
    message?: string
    data?: TokenPackage[]
  }
}

export async function createSellerPackage(payload: {
  title: string
  subtitle?: string
  description?: string
}) {
  const res = await api.post('/api/seller/packages', payload)
  return res.data as { success: boolean; message?: string; data?: TokenPackage }
}

export async function stopSellerPackage(id: number) {
  const res = await api.post(`/api/seller/packages/${id}/stop`)
  return res.data as { success: boolean; message?: string }
}

export async function relistSellerPackage(id: number) {
  const res = await api.post(`/api/seller/packages/${id}/relist`)
  return res.data as { success: boolean; message?: string }
}

export async function createSellerPackageVersion(id: number, payload: unknown) {
  const res = await api.post(`/api/seller/packages/${id}/versions`, payload)
  return res.data as { success: boolean; message?: string }
}

export async function fetchSellerLedger(page: number, pageSize: number) {
  const res = await api.get('/api/seller/ledger', {
    params: { p: page, page_size: pageSize },
  })
  return res.data as {
    success: boolean
    message?: string
    data?: { items: SellerLedgerEntry[]; total: number }
  }
}

export async function fetchSellerStats() {
  const res = await api.get('/api/seller/stats')
  return res.data as {
    success: boolean
    message?: string
    data?: SellerRevenueSummary
  }
}

export async function fetchMyChannels() {
  const res = await api.get('/api/user/channels')
  return res.data as {
    success: boolean
    message?: string
    data?: UserChannel[]
  }
}

export async function createMyChannel(payload: unknown) {
  const res = await api.post('/api/user/channels', payload)
  return res.data as { success: boolean; message?: string }
}

export async function deleteMyChannel(id: number) {
  const res = await api.delete(`/api/user/channels/${id}`)
  return res.data as { success: boolean; message?: string }
}

export async function testMyChannel(id: number) {
  const res = await api.post(`/api/user/channels/${id}/test`)
  return res.data as { success: boolean; message?: string; time?: number }
}

export async function fetchPendingReviews(page: number, pageSize: number) {
  const res = await api.get('/api/user/package-reviews', {
    params: { p: page, page_size: pageSize },
  })
  return res.data as {
    success: boolean
    message?: string
    data?: { items: PendingReview[]; total: number }
  }
}

export async function reviewPackageVersion(
  versionId: number,
  action: 'approve' | 'reject',
  reviewNote?: string
) {
  const res = await api.post(
    `/api/user/package-versions/${versionId}/${action}`,
    { review_note: reviewNote || '' }
  )
  return res.data as { success: boolean; message?: string }
}

export async function pausePackage(id: number) {
  const res = await api.post(`/api/user/packages/${id}/pause`)
  return res.data as { success: boolean; message?: string }
}

export async function resumePackage(id: number) {
  const res = await api.post(`/api/user/packages/${id}/resume`)
  return res.data as { success: boolean; message?: string }
}

export async function fetchVerifications(params: {
  page: number
  pageSize: number
  status?: string
  keyword?: string
}) {
  const res = await api.get('/api/user/verifications', {
    params: {
      p: params.page,
      page_size: params.pageSize,
      status: params.status || undefined,
      keyword: params.keyword || undefined,
    },
  })
  return res.data as {
    success: boolean
    message?: string
    data?: { items: AdminVerification[]; total: number }
  }
}

export async function reviewVerification(
  userId: number,
  approved: boolean,
  reviewNote?: string
) {
  const res = await api.post(`/api/user/verifications/${userId}/review`, {
    approved,
    review_note: reviewNote || '',
  })
  return res.data as { success: boolean; message?: string }
}

/** Withdraws an approved verification; the reason is shown to the user. */
export async function revokeVerification(userId: number, reason: string) {
  const res = await api.post(`/api/user/verifications/${userId}/revoke`, {
    review_note: reason,
  })
  return res.data as { success: boolean; message?: string }
}

export async function fetchUserChannelModels(params: {
  channelId?: number
  type?: number
  baseURL?: string
  key?: string
}) {
  const res = await api.post(
    '/api/user/channel_models',
    { base_url: params.baseURL || '', key: params.key || '' },
    {
      params: {
        channel_id: params.channelId || undefined,
        type: params.type || undefined,
      },
    }
  )
  return res.data as { success: boolean; message?: string; data?: string[] }
}

export async function terminatePackage(id: number) {
  const res = await api.post(`/api/user/packages/${id}/terminate`)
  return res.data as { success: boolean; message?: string }
}

export type { PackageVersion }
