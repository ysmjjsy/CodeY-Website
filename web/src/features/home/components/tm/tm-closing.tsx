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
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

interface TmClosingProps {
  onOpenPublish?: () => void
}

export function TmClosing(props: TmClosingProps) {
  const { t } = useTranslation()
  return (
    <section
      className='tm-closing tm-shell tm-space'
      aria-labelledby='tm-closing-title'
    >
      <p className='tm-label'>
        {t('CodeGuys model access and trading platform')}
      </p>
      <h2 id='tm-closing-title'>
        {t('Need a model? Call it directly.')}
        <br />
        {t('Have a model? Open it for calls.')}
      </h2>
      <div className='tm-closing-actions'>
        <Button size='lg' render={<Link to='/pricing' />}>
          {t('Enter the model market')}
          <ArrowRight aria-hidden='true' />
        </Button>
        <Button
          variant='outline'
          size='lg'
          onClick={() => props.onOpenPublish?.()}
        >
          {t('Publish model')}
        </Button>
      </div>
    </section>
  )
}
