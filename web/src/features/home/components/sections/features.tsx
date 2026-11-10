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
import {
  Code,
  DollarSign,
  Gauge,
  Globe,
  Server,
  Shield,
  Users,
  Zap,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { AnimateInView } from '@/components/animate-in-view'

interface FeaturesProps {
  className?: string
}

export function Features(_props: FeaturesProps) {
  const { t } = useTranslation()
  const gridRef = useRef<HTMLDivElement>(null)

  // The corner brackets draw themselves once the grid is on screen. With
  // reduced motion they are drawn from the start, which is the finished frame.
  useEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof IntersectionObserver === 'undefined'
    ) {
      grid.classList.add('is-drawn')
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          grid.classList.add('is-drawn')
          observer.disconnect()
        }
      },
      { threshold: 0.2 }
    )
    observer.observe(grid)
    return () => observer.disconnect()
  }, [])

  const features = [
    {
      title: t('Lightning Fast'),
      desc: t(
        'Optimized network architecture ensures millisecond response times'
      ),
      icon: Zap,
    },
    {
      title: t('Secure & Reliable'),
      desc: t(
        'Enterprise-grade security with comprehensive permission management'
      ),
      icon: Shield,
    },
    {
      title: t('Global Coverage'),
      desc: t('Multi-region deployment for stable global access'),
      icon: Globe,
    },
    {
      title: t('Developer Friendly'),
      desc: t('Compatible API routes for common AI application workflows'),
      icon: Code,
    },
    {
      title: t('High Performance'),
      desc: t('Support for high concurrency with automatic load balancing'),
      icon: Gauge,
    },
    {
      title: t('Transparent Billing'),
      desc: t('Pay-as-you-go with real-time usage monitoring'),
      icon: DollarSign,
    },
    {
      title: t('Team Collaboration'),
      desc: t('Multi-user management with flexible permission allocation'),
      icon: Users,
    },
    {
      title: t('Self-hosted'),
      desc: t('Run it on your own infrastructure and extend it as you need'),
      icon: Server,
    },
  ]

  return (
    <section className='px-6 py-24 md:py-32'>
      <div className='mx-auto max-w-6xl'>
        <AnimateInView className='mb-14 max-w-lg'>
          <p className='text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase'>
            {t('Core Features')}
          </p>
          <h2 className='text-2xl leading-tight font-bold tracking-tight md:text-3xl'>
            {t('Built for developers,')}
            <br />
            {t('designed for scale')}
          </h2>
        </AnimateInView>

        <div
          ref={gridRef}
          data-feature-grid
          className='border-border grid grid-cols-1 border-t border-l sm:grid-cols-2 lg:grid-cols-4'
        >
          {features.map((feature, index) => (
            <AnimateInView
              key={feature.title}
              delay={index * 60}
              animation='fade-in'
              className='border-border border-r border-b'
            >
              <div
                className='feature-cell h-full p-6'
                style={{ '--bracket': index } as React.CSSProperties}
              >
                <feature.icon
                  className='text-foreground mb-4 size-4'
                  strokeWidth={1.5}
                  aria-hidden='true'
                />
                <h3 className='text-sm font-semibold'>{feature.title}</h3>
                <p className='text-muted-foreground mt-1.5 text-sm leading-relaxed'>
                  {feature.desc}
                </p>
              </div>
            </AnimateInView>
          ))}
        </div>
      </div>
    </section>
  )
}
