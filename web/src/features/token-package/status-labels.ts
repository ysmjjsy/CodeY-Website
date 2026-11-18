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
export const packageStatusLabels: Record<string, string> = {
  draft: 'Draft',
  listed: 'Listed',
  paused: 'Paused',
  stopped: 'Stopped',
  terminated: 'Terminated',
}

export const versionStatusLabels: Record<string, string> = {
  draft: 'Draft',
  testing: 'Testing',
  pending_review: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  superseded: 'Superseded',
}

export const entitlementStatusLabels: Record<string, string> = {
  active: 'Active',
  exhausted: 'Exhausted',
  expired: 'Expired',
  terminated: 'Terminated',
}

export const ledgerTypeLabels: Record<string, string> = {
  sale_pending: 'Sale pending',
  release: 'Release',
  settle: 'Settle',
  refund: 'Refund',
}

export const ledgerStatusLabels: Record<string, string> = {
  pending: 'Pending',
  frozen: 'Frozen',
  settled: 'Settled',
  completed: 'Completed',
}

export const verificationStatusLabels: Record<string, string> = {
  unverified: 'Unverified',
  pending: 'Pending',
  verified: 'Verified',
  rejected: 'Rejected',
}

export const sellerReasonLabels: Record<string, string> = {
  need_verification: 'Needs verification',
  not_authorized: 'Not authorized',
  banned: 'Banned',
}

export function statusLabel(
  labels: Record<string, string>,
  code: string | undefined
): string {
  if (!code) return ''
  return labels[code] ?? code
}
