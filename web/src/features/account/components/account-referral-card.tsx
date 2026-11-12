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
import { useQuery } from '@tanstack/react-query'
import { Share2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { TitledCard } from '@/components/ui/titled-card'
import type { UserProfile } from '@/features/profile/types'
import { getAffiliateCode } from '@/features/wallet/api'
import { generateAffiliateLink } from '@/features/wallet/lib/affiliate'
import { formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

type AccountReferralCardProps = {
  profile: UserProfile | null
}

export function AccountReferralCard(props: AccountReferralCardProps) {
  const { t } = useTranslation()
  const profileCode = props.profile?.aff_code ?? ''
  const codeQuery = useQuery({
    queryKey: ['account', 'affiliate-code'],
    queryFn: async () => {
      const response = requireServerSuccess(await getAffiliateCode())
      return response.data ?? ''
    },
    enabled: Boolean(props.profile) && !profileCode,
    staleTime: Infinity,
    meta: { errorToast: false },
  })
  const affiliateCode = profileCode || codeQuery.data || ''

  if (!affiliateCode) return null

  const affiliateLink = generateAffiliateLink(affiliateCode)

  return (
    <TitledCard
      title={t('Referral Program')}
      icon={<Share2 className='size-4' />}
      iconTone='chart-3'
      disableHoverEffect
      headerClassName='px-4 py-3 !pb-3'
      contentClassName='space-y-3 p-4'
      titleClassName='text-sm'
      iconClassName='size-7'
    >
      <dl className='grid grid-cols-3 gap-1.5 text-center'>
        {[
          [t('Pending'), formatQuota(props.profile?.aff_quota ?? 0)],
          [
            t('Total Earned'),
            formatQuota(props.profile?.aff_history_quota ?? 0),
          ],
          [t('Invites'), String(props.profile?.aff_count ?? 0)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className='text-muted-foreground truncate text-[10px] font-medium tracking-wider uppercase'>
              {label}
            </dt>
            <dd className='mt-0.5 truncate text-sm font-semibold tabular-nums'>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <CopyButton
        value={affiliateLink}
        variant='outline'
        size='sm'
        className='w-full'
        iconClassName='size-3.5'
        aria-label={t('Copy referral link')}
      >
        {t('Copy referral link')}
      </CopyButton>
    </TitledCard>
  )
}
