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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { TmBilling } from '../tm-billing'

/**
 * The prototype's wallet card is an interactive demo for every visitor: it
 * shows the shared demo balance and its button opens the top-up modal — no
 * sign-in gate, no navigation away.
 */
describe('billing wallet demo', () => {
  it('shows the starting ¥200 demo balance without a prop', () => {
    render(<TmBilling />)

    expect(screen.getByText('¥ 200.00')).toBeInTheDocument()
  })

  it('shows the updated balance after demo top-ups', () => {
    render(<TmBilling balance={350} />)

    expect(screen.getByText('¥ 350.00')).toBeInTheDocument()
  })

  it('opens the top-up demo for any visitor when the button is clicked', async () => {
    const onOpenTopup = vi.fn()
    render(<TmBilling balance={200} onOpenTopup={onOpenTopup} />)

    await userEvent.click(
      screen.getByRole('button', { name: /top up credit/i })
    )

    expect(onOpenTopup).toHaveBeenCalledTimes(1)
  })

  it('exposes the #billing-section anchor like the prototype', () => {
    const { container } = render(<TmBilling />)

    expect(container.querySelector('#billing-section')).not.toBeNull()
  })
})
