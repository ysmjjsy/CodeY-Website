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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { VerificationReviews } from '../index'

const verifiedUser = {
  user_id: 5,
  username: 'alice',
  status: 'verified',
  masked_name: '张*',
  seller_group: true,
  updated_at: 1763424000,
}

function renderReviews() {
  vi.spyOn(api, 'get').mockImplementation(async (url, config) => {
    if (url === '/api/user/verifications') {
      const status = (config?.params as { status?: string } | undefined)?.status
      const items = status === 'verified' ? [verifiedUser] : []
      return { data: { success: true, data: { items, total: items.length } } }
    }
    throw new Error(`unexpected request ${String(url)}`)
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: true } })
  render(<VerificationReviews />)
  return post
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('revoking without a reason asks for one and sends nothing', async () => {
  const post = renderReviews()
  await userEvent.click(screen.getByRole('tab', { name: 'Verified' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }))

  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(post).not.toHaveBeenCalled()
})

test('revoking with a reason confirms first and then sends the reason', async () => {
  const post = renderReviews()
  await userEvent.click(screen.getByRole('tab', { name: 'Verified' }))
  await userEvent.type(
    await screen.findByRole('textbox', { name: 'Review note' }),
    'document was forged'
  )
  await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))

  const dialog = await screen.findByRole('alertdialog')
  expect(post).not.toHaveBeenCalled()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))

  await waitFor(() =>
    expect(post).toHaveBeenCalledWith('/api/user/verifications/5/revoke', {
      review_note: 'document was forged',
    })
  )
})
