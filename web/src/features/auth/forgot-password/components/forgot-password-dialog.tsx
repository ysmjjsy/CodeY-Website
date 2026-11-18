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
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useStatus } from '@/hooks/use-status'
import { useAuthDialogStore } from '@/stores/auth-dialog-store'

import { ForgotPasswordForm } from './forgot-password-form'

/**
 * The password reset form for the shared auth dialog. The form is the same one
 * the `/forgot-password` page uses.
 */
export function ForgotPasswordDialogContent(props: {
  /** Carried back to sign-in, so a reset started from a protected page keeps its target. */
  redirectTo?: string
}) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const openAuthDialog = useAuthDialogStore((state) => state.openAuthDialog)
  const registrationOpen =
    !status?.self_use_mode_enabled && status?.register_enabled !== false

  return (
    <>
      <DialogHeader>
        <DialogTitle className='text-lg'>{t('Forgot password')}</DialogTitle>
        <DialogDescription>
          {t(
            'Enter your registered email and we will send you a link to reset your password.'
          )}
          {registrationOpen && (
            <>
              {' '}
              {t("Don't have an account?")}{' '}
              <Button
                type='button'
                variant='link'
                className='text-foreground h-auto p-0 text-sm font-medium'
                onClick={() => openAuthDialog('sign-up', props.redirectTo)}
              >
                {t('Sign up')}
              </Button>
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      <ForgotPasswordForm />
    </>
  )
}
