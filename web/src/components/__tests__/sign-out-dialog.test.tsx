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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignOutDialog } from '@/components/sign-out-dialog'

/**
 * Signing out returns to the public site. The sign-in page is where someone
 * arrives signed out, not where someone lands after choosing to leave.
 */

vi.mock('@/features/auth/api', () => ({
  logout: vi.fn(async () => ({ success: true })),
}))

afterEach(() => {
  cleanup()
})

describe('signing out', () => {
  it('returns to the public homepage', async () => {
    const root = createRootRoute()
    const home = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <div>Home</div>,
    })
    const dashboard = createRoute({
      getParentRoute: () => root,
      path: '/dashboard',
      component: () => (
        <>
          <div>Dashboard</div>
          <SignOutDialog open onOpenChange={() => undefined} />
        </>
      ),
    })
    const router = createRouter({
      routeTree: root.addChildren([home, dashboard]),
      history: createMemoryHistory({ initialEntries: ['/dashboard'] }),
    })
    await router.load()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sign out' })
    )

    expect(await screen.findByText('Home')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
