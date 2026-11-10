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
import { useAuthDialogStore } from '@/stores/auth-dialog-store'

import { ForgotPasswordDialogContent } from '../forgot-password/components/forgot-password-dialog'
import { SignInDialogContent } from '../sign-in/components/sign-in-dialog'
import { SignUpDialogContent } from '../sign-up/components/sign-up-dialog'
import { AuthDialogFrame } from './auth-dialog-frame'

/**
 * The one dialog for signing in, registering, and resetting a password. The
 * frame stays open while the form on the right changes, so switching does not
 * replay the dialog animation.
 */
export function AuthDialogs() {
  const view = useAuthDialogStore((state) => state.view)
  const redirectTo = useAuthDialogStore((state) => state.redirectTo)
  const closeAuthDialog = useAuthDialogStore((state) => state.closeAuthDialog)

  let content = (
    <SignInDialogContent redirectTo={redirectTo} onClose={closeAuthDialog} />
  )
  if (view === 'sign-up') {
    content = <SignUpDialogContent redirectTo={redirectTo} />
  } else if (view === 'forgot-password') {
    content = <ForgotPasswordDialogContent redirectTo={redirectTo} />
  }

  return (
    <AuthDialogFrame
      open={view !== null}
      onOpenChange={(open) => {
        if (!open) closeAuthDialog()
      }}
    >
      {view !== null && content}
    </AuthDialogFrame>
  )
}
