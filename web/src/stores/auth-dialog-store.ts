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
import { create } from 'zustand'

/** Which form the shared auth dialog is showing. Null means it is closed. */
export type AuthDialogView = 'sign-in' | 'sign-up' | 'forgot-password'

interface AuthDialogState {
  view: AuthDialogView | null
  /** Where a successful sign-in returns to. Absent means the current page. */
  redirectTo: string | undefined
  openAuthDialog: (view: AuthDialogView, redirectTo?: string) => void
  closeAuthDialog: () => void
}

/**
 * Sign-in, registration, and password reset share one dialog, so a link inside
 * one form can switch to another without leaving the page. The dialog itself is
 * rendered once, in the public header.
 */
export const useAuthDialogStore = create<AuthDialogState>((set) => ({
  view: null,
  redirectTo: undefined,
  openAuthDialog: (view, redirectTo) => set({ view, redirectTo }),
  closeAuthDialog: () => set({ view: null }),
}))
