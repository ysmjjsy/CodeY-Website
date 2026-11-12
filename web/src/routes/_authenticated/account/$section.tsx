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
import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

import { Account } from '@/features/account'
import {
  ACCOUNT_DEFAULT_SECTION,
  ACCOUNT_SECTION_IDS,
} from '@/features/account/sections'
import { API_KEY_STATUS_OPTIONS } from '@/features/keys/constants'

const accountSearchSchema = z.object({
  show_history: z.boolean().optional(),
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(undefined),
  status: z
    .array(z.enum(API_KEY_STATUS_OPTIONS.map((s) => s.value as `${number}`)))
    .optional()
    .catch([]),
  filter: z.string().optional().catch(''),
  token: z.string().optional().catch(''),
})

export const Route = createFileRoute('/_authenticated/account/$section')({
  validateSearch: accountSearchSchema,
  beforeLoad: ({ params }) => {
    const validSections = ACCOUNT_SECTION_IDS as readonly string[]
    if (!validSections.includes(params.section)) {
      throw redirect({
        to: '/account/$section',
        params: { section: ACCOUNT_DEFAULT_SECTION },
      })
    }
  },
  component: Account,
})
