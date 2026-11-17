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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { PublishPreview } from '../sections/publish-preview'

afterEach(() => {
  cleanup()
})

describe('the publish journey rail', () => {
  it('shows the first step selected and its detail card on load', () => {
    render(<PublishPreview />)

    const connect = screen.getByRole('button', { name: /connect/i })
    expect(connect).toHaveAttribute('aria-pressed', 'true')
    // The detail card mirrors the selected step.
    expect(
      screen.getByRole('heading', {
        name: 'Bring your model to one endpoint.',
      })
    ).toBeInTheDocument()
  })

  it('moves selection and swaps the detail card when a later step is chosen', async () => {
    const user = userEvent.setup()
    render(<PublishPreview />)

    const publish = screen.getByRole('button', { name: /publish/i })
    await user.click(publish)

    expect(publish).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /connect/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    expect(
      screen.getByRole('heading', {
        name: 'Open it to buyers who need it.',
      })
    ).toBeInTheDocument()
  })

  it('renders every journey step as a keyboard-operable button', () => {
    render(<PublishPreview />)

    const buttons = screen
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-pressed'))
    expect(buttons).toHaveLength(4)
  })
})
