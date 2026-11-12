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
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { UserAvatar } from '../user-avatar'

afterEach(() => {
  vi.unstubAllGlobals()
})

test('shows the username initial when no avatar has been uploaded', () => {
  render(<UserAvatar user={{ username: 'root', display_name: 'Root User' }} />)

  expect(screen.getByText('R')).toBeVisible()
  expect(document.querySelector('img')).toBeNull()
})

test('renders the uploaded avatar with its accessible name', async () => {
  // jsdom never loads images, so resolve the avatar preload immediately.
  class LoadedImage {
    complete = false
    naturalWidth = 64
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('Image', LoadedImage)

  render(
    <UserAvatar
      user={{
        username: 'root',
        display_name: 'Root User',
        avatar_url: '/api/avatar/abc.png',
      }}
      alt='Root User'
    />
  )

  await waitFor(() =>
    expect(screen.getByRole('img', { name: 'Root User' })).toHaveAttribute(
      'src',
      '/api/avatar/abc.png'
    )
  )
})
