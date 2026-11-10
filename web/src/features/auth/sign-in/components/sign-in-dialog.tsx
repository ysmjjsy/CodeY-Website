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

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useStatus } from '@/hooks/use-status'
import { useAuthDialogStore } from '@/stores/auth-dialog-store'

import { TermsFooter } from '../../components/terms-footer'
import { UserAuthForm } from './user-auth-form'

/**
 * The sign-in form for the shared auth dialog. The form is the same one the
 * `/sign-in` page uses.
 */
export function SignInDialogContent(props: {
  /** Where a successful sign-in returns to. Absent means the current page. */
  redirectTo?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const openAuthDialog = useAuthDialogStore((state) => state.openAuthDialog)
  const registrationOpen =
    !status?.self_use_mode_enabled && status?.register_enabled !== false

  return (
    <>
      <DialogHeader>
        <DialogTitle className='text-lg'>{t('Sign in')}</DialogTitle>
        {registrationOpen && (
          <DialogDescription>
            {t("Don't have an account?")}{' '}
            <button
              type='button'
              className='text-foreground font-medium underline underline-offset-4'
              onClick={() => openAuthDialog('sign-up', props.redirectTo)}
            >
              {t('Sign up')}
            </button>
          </DialogDescription>
        )}
      </DialogHeader>

      <UserAuthForm
        compact
        redirectTo={props.redirectTo}
        onSignedIn={props.onClose}
        onForgotPassword={() =>
          openAuthDialog('forgot-password', props.redirectTo)
        }
      />

      <TermsFooter variant='sign-in' status={status} className='text-center' />
    </>
  )
}
