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

import { TermsFooter } from '../../components/terms-footer'
import { SignUpForm } from './sign-up-form'

/**
 * The registration form for the shared auth dialog. The form is the same one
 * the `/sign-up` page uses.
 */
export function SignUpDialogContent(props: {
  /** Where a sign-in that follows a successful registration returns to. */
  redirectTo?: string
}) {
  const { t } = useTranslation()
  const { status } = useStatus()
  const openAuthDialog = useAuthDialogStore((state) => state.openAuthDialog)

  return (
    <>
      <DialogHeader>
        <DialogTitle className='text-lg'>{t('Create an account')}</DialogTitle>
        <DialogDescription>
          {t('Already have an account?')}{' '}
          <Button
            type='button'
            variant='link'
            className='text-foreground h-auto p-0 text-sm font-medium'
            onClick={() => openAuthDialog('sign-in', props.redirectTo)}
          >
            {t('Sign in')}
          </Button>
        </DialogDescription>
      </DialogHeader>

      <SignUpForm
        compact
        onRegistered={() => openAuthDialog('sign-in', props.redirectTo)}
      />

      <TermsFooter variant='sign-up' status={status} className='text-center' />
    </>
  )
}
