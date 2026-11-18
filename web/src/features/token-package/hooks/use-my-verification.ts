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
import { useQuery } from '@tanstack/react-query'

import { requireServerSuccess } from '@/lib/server-error-message'

import { fetchMyVerification } from '../api'
import type { VerificationStatus } from '../types'

export const myVerificationQueryKey = ['token-package', 'verification'] as const

const UNVERIFIED: VerificationStatus = { status: 'unverified' }

/**
 * The signed-in user's real-name state. Buyers must be verified before they
 * can purchase (D17), so the market, the account page and the seller center
 * all read the same query and refresh together after a submission.
 */
export function useMyVerification(enabled = true) {
  return useQuery({
    queryKey: myVerificationQueryKey,
    enabled,
    queryFn: async (): Promise<VerificationStatus> => {
      const res = requireServerSuccess(await fetchMyVerification())
      return res.data || UNVERIFIED
    },
  })
}
