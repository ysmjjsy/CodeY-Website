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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import type { VerificationStatus } from '../../types'
import { VerificationPanel } from '../verification-panel'

function renderPanel(verification: VerificationStatus) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/verification') {
      return { data: { success: true, data: verification } }
    }
    throw new Error(`unexpected request ${String(url)}`)
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <VerificationPanel />
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('a pending submission shows its review state instead of the form', async () => {
  renderPanel({ status: 'pending', updated_at: 1763424000 })

  expect(await screen.findByText('Under review')).toBeVisible()
  expect(screen.queryByLabelText('ID number')).not.toBeInTheDocument()
})

test('a rejected submission shows the reviewer reason and lets the user resubmit', async () => {
  renderPanel({ status: 'rejected', review_note: 'Name does not match' })

  expect(await screen.findByText('Name does not match')).toBeVisible()
  expect(screen.getByLabelText('ID number')).toBeVisible()
})

test('submitting stays disabled until name, ID number and consent are all given', async () => {
  renderPanel({ status: 'unverified' })
  const submit = await screen.findByRole('button', {
    name: 'Submit for review',
  })
  expect(submit).toBeDisabled()

  await userEvent.type(screen.getByLabelText('Legal name'), 'Zhang San')
  await userEvent.type(screen.getByLabelText('ID number'), '11010519491231002X')
  expect(submit).toBeDisabled()

  await userEvent.click(screen.getByRole('checkbox'))
  expect(submit).toBeEnabled()
})
