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
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { STATUS_QUERY_KEY } from '@/lib/status-query'
import { useAuthDialogStore } from '@/stores/auth-dialog-store'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { PublicHeader } from '../public-header'

/**
 * Signing in happens in a dialog over the current page, and the console is an
 * entry in the account menu rather than an item in the bar.
 */

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
  useAuthDialogStore.getState().closeAuthDialog()
  vi.restoreAllMocks()
})

function renderHeader(signedIn: boolean) {
  // The header shows a skeleton while the config is loading, and the store
  // starts out loading.
  useSystemConfigStore.getState().setLoading(false)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(STATUS_QUERY_KEY, {
    system_name: 'CodeGuys',
    register_enabled: true,
  })
  if (signedIn) {
    // A full bundle, not a bare user: boot checks the session with the server
    // and clears a user that has none.
    useAuthStore.getState().auth.setBundle({
      access_token: 'token',
      token_type: 'Bearer',
      access_expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 1, username: 'alice', role: 1 },
      session: {
        sid: 'session',
        current: true,
        login_method: 'password',
        ip: '',
        user_agent: '',
        created_at: 0,
        last_active_at: 0,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    })
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <PublicHeader /> }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  // The header reads the signed-in user on its first render, so the router has
  // to be ready before that render or it paints the signed-out bar.
  return router.load().then(() =>
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  )
}

describe('the public header', () => {
  it('opens the sign-in dialog instead of leaving the page', async () => {
    await renderHeader(false)

    // The bar renders a desktop and a mobile sign-in; the hidden one sits
    // inside a `hidden` container.
    const signIn = (
      await screen.findAllByRole('button', { name: 'Sign in' })
    ).find((button) => button.closest('.hidden') === null)
    expect(signIn).toBeDefined()
    await userEvent.click(signIn as HTMLElement)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Username or Email')
    expect(dialog).toHaveTextContent('Password')
    // The form sits beside the homepage's coordinate paper and the gateway's
    // mark, so the dialog is not a bare form.
    expect(dialog.querySelector('.hero-grid')).not.toBeNull()
    // One arc behind the panel, and the stroked hexagon of each mark.
    expect(dialog.querySelectorAll('circle')).toHaveLength(1)
    expect(dialog.querySelectorAll('polygon')).toHaveLength(4)
    // Two marks share the dialog, so each image has to point at its own filter.
    const filterRefs = [...dialog.querySelectorAll('image')].map((image) =>
      image.getAttribute('filter')
    )
    expect(new Set(filterRefs).size).toBe(2)
    expect(
      screen.queryByRole('link', { name: 'Console' })
    ).not.toBeInTheDocument()
  })

  it('opens registration and password reset in the same dialog', async () => {
    await renderHeader(false)

    const signIn = (
      await screen.findAllByRole('button', { name: 'Sign in' })
    ).find((button) => button.closest('.hidden') === null)
    await userEvent.click(signIn as HTMLElement)

    const dialog = await screen.findByRole('dialog')
    const paper = dialog.querySelector('.hero-grid')

    // Registration replaces the form without leaving the page, and the dialog
    // itself stays put, so the panel on the left does not redraw.
    await userEvent.click(
      await screen.findByRole('button', { name: 'Sign up' })
    )
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(dialog.querySelector('.hero-grid')).toBe(paper)
    expect(dialog).toHaveTextContent('Create an account')
    expect(dialog).toHaveTextContent('Username')

    // And the same frame carries password reset.
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await userEvent.click(
      await screen.findByRole('button', { name: 'Forgot password?' })
    )
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'Forgot password'
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Enter your registered email'
    )
  })

  it('keeps the console in the account menu and out of the bar', async () => {
    await renderHeader(true)

    const avatar = (
      await screen.findAllByRole('button', { name: 'Account menu' })
    ).find((button) => button.closest('.hidden') === null)
    expect(avatar).toBeDefined()
    expect(
      screen.queryByRole('link', { name: 'Console' })
    ).not.toBeInTheDocument()

    await userEvent.click(avatar as HTMLElement)

    expect(
      await screen.findByRole('menuitem', { name: 'Console' })
    ).toBeInTheDocument()
  })
})
