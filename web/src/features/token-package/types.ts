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

export interface PackageModelSpec {
  model: string
  multiplier: number
}

export interface PackageSKU {
  sku_key: string
  title: string
  price_quota: number
  credit_quota: number
  valid_days: number
}

export interface PackageChannelTestItem {
  channel_id: number
  channel_name?: string
  model: string
  success: boolean
  returned_model?: string
  model_mismatch?: boolean
  latency_ms?: number
  error?: string
}

export interface PackageTestReport {
  checked_at: number
  passed: boolean
  results: PackageChannelTestItem[] | null
  fail_reasons: string[] | null
}

export interface PackageVersion {
  id: number
  package_id: number
  version_no: number
  status: string
  models: PackageModelSpec[] | null
  skus: PackageSKU[] | null
  channels?:
    | {
        channel_id: number
        models: string[] | null
        priority: number
        weight: number
      }[]
    | null
  test_report?: PackageTestReport | null
  submitted_at: number
  reviewed_by: number
  reviewed_at: number
  review_note: string
  created_at: number
}

export interface TokenPackage {
  id: number
  seller_user_id: number
  seller_name: string
  billing_mode: string
  title: string
  subtitle: string
  description: string
  status: string
  active_version_id: number
  degraded: boolean
  active_version?: PackageVersion | null
  latest_version?: PackageVersion | null
  created_at: number
  updated_at: number
}

export interface PackageOrder {
  id: number
  trade_no: string
  buyer_user_id: number
  package_id: number
  package_title: string
  version_id: number
  sku_snapshot?: PackageSKU | null
  price_quota: number
  commission_bps: number
  commission_quota: number
  seller_quota: number
  status: string
  refunded_quota: number
  created_at: number
}

export interface PackageEntitlement {
  id: number
  user_id: number
  package_id: number
  package_title: string
  package_status: string
  version_id: number
  order_id: number
  billing_mode: string
  models_snapshot: PackageModelSpec[] | null
  amount_total: number
  amount_used: number
  amount_remaining: number
  paid_quota: number
  start_time: number
  end_time: number
  extended_seconds: number
  status: string
  refunded_quota: number
  created_at: number
}

export interface SellerStatus {
  eligible: boolean
  verified: boolean
  in_seller_group: boolean
  publish_banned: boolean
  ban_reason: string
  reasons: string[] | null
  verification_status: string
}

export type VerificationState =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected'

export interface VerificationStatus {
  status: VerificationState
  provider?: string
  provider_trace_id?: string
  masked_name?: string
  /** Present only for a rejected submission: what the reviewer asked to fix. */
  review_note?: string
  verified_at?: number
  updated_at?: number
}

export interface SellerLedgerEntry {
  id: number
  seller_user_id: number
  entitlement_id: number
  order_id: number
  type: string
  amount: number
  available_at: number
  status: string
  created_at: number
}

export interface SellerRevenueSummary {
  pending_quota: number
  frozen_quota: number
  settled_total_quota: number
  sales_count: number
  sales_quota: number
}

export interface AdminVerification {
  user_id: number
  username: string
  status: string
  provider: string
  provider_trace_id: string
  masked_name: string
  review_note: string
  reviewed_by: number
  consent_at: number
  consent_version: string
  verified_at: number
  created_at: number
  /** The user is in a group that may publish; otherwise a buyer verifying to purchase. */
  seller_group: boolean
  updated_at: number
}

export interface UserChannel {
  id: number
  name: string
  type: number
  base_url: string
  models: string[] | null
  model_mapping: string
  test_model: string
  priority: number
  weight: number
  status: number
  created_time: number
  bound_packages?: string[] | null
}

export interface PendingReview {
  version: PackageVersion
  package: TokenPackage
  seller_user_id: number
  seller_name: string
}

export interface PageResult<T> {
  page: number
  page_size: number
  total: number
  items: T[]
}
