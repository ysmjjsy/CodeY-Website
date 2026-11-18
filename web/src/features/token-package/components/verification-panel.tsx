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
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  SecureVerificationDialog,
  useSecureVerification,
} from '@/features/auth/secure-verification'
import { formatTimestampToDate } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { createServerError } from '@/lib/server-error-message'

import { submitVerification } from '../api'
import {
  myVerificationQueryKey,
  useMyVerification,
} from '../hooks/use-my-verification'

/**
 * The consent text below is versioned. Bump this together with the server's
 * realname.CurrentConsentVersion whenever the text or its purpose changes.
 */
export const REALNAME_CONSENT_VERSION = '2026-11-18.2'

type VerificationPanelProps = {
  /** Called after a submission is accepted, for pages that cache their own state. */
  onSubmitted?: () => void
}

export function VerificationPanel(props: VerificationPanelProps) {
  const { t } = useTranslation()
  const query = useMyVerification()

  if (query.isPending) {
    return <LoadingState message={t('Loading...')} />
  }
  if (query.isError) {
    return (
      <ErrorState
        title={t('Failed to load your real-name status')}
        onRetry={() => void query.refetch()}
      />
    )
  }

  const verification = query.data
  if (verification.status === 'verified') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('Verified')}</CardTitle>
          <CardDescription>
            {t('Your real-name verification is complete.')}
          </CardDescription>
        </CardHeader>
        {verification.masked_name && (
          <CardContent className='text-muted-foreground text-sm'>
            {verification.masked_name}
          </CardContent>
        )}
      </Card>
    )
  }

  if (verification.status === 'pending') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('Under review')}</CardTitle>
          <CardDescription>
            {t(
              'An administrator is reviewing your submission. You will be notified when it is done.'
            )}
          </CardDescription>
        </CardHeader>
        {verification.updated_at ? (
          <CardContent className='text-muted-foreground text-sm'>
            {t('Submitted at {{time}}', {
              time: formatTimestampToDate(verification.updated_at),
            })}
          </CardContent>
        ) : null}
      </Card>
    )
  }

  return (
    <div className='space-y-4'>
      {verification.status === 'rejected' && (
        <Alert variant='destructive'>
          <AlertTitle>
            {t('Your real-name verification was rejected')}
          </AlertTitle>
          <AlertDescription>
            {verification.review_note ||
              t('Correct your details and submit again.')}
          </AlertDescription>
        </Alert>
      )}
      <VerificationForm onSubmitted={props.onSubmitted} />
    </div>
  )
}

function VerificationForm(props: VerificationPanelProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const secure = useSecureVerification()
  const [realName, setRealName] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [consent, setConsent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const canSubmit =
    !submitting && realName.trim() !== '' && idNumber.trim() !== '' && consent

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const proof = await secure.requestVerification({
        scope: 'realname.submit',
      })
      if (!proof) return
      const res = await submitVerification(
        {
          real_name: realName.trim(),
          id_number: idNumber.trim(),
          consent: true,
          consent_version: REALNAME_CONSENT_VERSION,
        },
        proof.proof_token
      )
      if (!res.success) {
        handleServerError(
          createServerError(res, t('Verification could not be submitted'))
        )
        return
      }
      // The ID number is not kept in the page once the server has it.
      setIdNumber('')
      setRealName('')
      setConsent(false)
      toast.success(t('Verification submitted'))
      await queryClient.invalidateQueries({ queryKey: myVerificationQueryKey })
      props.onSubmitted?.()
    } catch (error) {
      handleServerError(error, t('Verification could not be submitted'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Real-name verification')}</CardTitle>
        <CardDescription>
          {t(
            'Buying token packages requires real-name verification. We store only a masked name and a one-way hash of your ID number.'
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className='max-w-md space-y-3'>
        <div className='space-y-1.5'>
          <Label htmlFor='realname-legal-name'>{t('Legal name')}</Label>
          <Input
            id='realname-legal-name'
            autoComplete='off'
            value={realName}
            onChange={(event) => setRealName(event.target.value)}
          />
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='realname-id-number'>{t('ID number')}</Label>
          <Input
            id='realname-id-number'
            type='password'
            autoComplete='off'
            value={idNumber}
            onChange={(event) => setIdNumber(event.target.value)}
          />
        </div>
        <label className='flex items-start gap-2 text-sm'>
          <Checkbox
            checked={consent}
            onCheckedChange={(checked) => setConsent(checked === true)}
          />
          <span>
            {t(
              'I agree that my real-name information is used to check my eligibility to buy and publish token packages and to stop anyone from buying their own packages.'
            )}
          </span>
        </label>
        <Button disabled={!canSubmit} onClick={() => void submit()}>
          {submitting ? t('Submitting...') : t('Submit for review')}
        </Button>
      </CardContent>
      <SecureVerificationDialog {...secure.dialogProps} />
    </Card>
  )
}
