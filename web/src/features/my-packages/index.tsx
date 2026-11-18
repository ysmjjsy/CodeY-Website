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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { CreatedPackages } from './components/created-packages'
import { PurchasedPackages } from './components/purchased-packages'

type PackageView = 'created' | 'purchased'

export function MyPackages() {
  const { t } = useTranslation()
  const [view, setView] = useState<PackageView>('created')

  const changeView = (next: string) => {
    setView(next === 'purchased' ? 'purchased' : 'created')
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('My token packages')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <Tabs value={view} onValueChange={changeView}>
          <TabsList>
            <TabsTrigger value='created'>{t('Created by me')}</TabsTrigger>
            <TabsTrigger value='purchased'>{t('Purchased by me')}</TabsTrigger>
          </TabsList>
          <TabsContent value='created' className='mt-4'>
            <CreatedPackages />
          </TabsContent>
          <TabsContent value='purchased' className='mt-4'>
            <PurchasedPackages />
          </TabsContent>
        </Tabs>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
