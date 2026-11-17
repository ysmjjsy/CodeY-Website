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
import { Link, useRouterState } from '@tanstack/react-router'
import { ChevronDown } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { LanguageSwitcher } from '@/components/language-switcher'
import { NotificationPopover } from '@/components/notification-popover'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthDialogs } from '@/features/auth/components/auth-dialogs'
import { useNotifications } from '@/hooks/use-notifications'
import { useSystemConfig } from '@/hooks/use-system-config'
import { useTopNavLinks } from '@/hooks/use-top-nav-links'
import { cn } from '@/lib/utils'
import { useAuthDialogStore } from '@/stores/auth-dialog-store'
import { useAuthStore } from '@/stores/auth-store'

import { defaultTopNavLinks } from '../config/top-nav.config'
import type { TopNavLink } from '../types'
import { HeaderLogo } from './header-logo'

export interface PublicHeaderProps {
  navLinks?: TopNavLink[]
  mobileLinks?: TopNavLink[]
  navContent?: React.ReactNode
  showThemeSwitch?: boolean
  showLanguageSwitcher?: boolean
  logo?: React.ReactNode
  siteName?: string
  homeUrl?: string
  leftContent?: React.ReactNode
  rightContent?: React.ReactNode
  showNavigation?: boolean
  showAuthButtons?: boolean
  showNotifications?: boolean
  className?: string
}

export function PublicHeader(props: PublicHeaderProps) {
  const {
    navLinks = defaultTopNavLinks,
    showThemeSwitch = true,
    showLanguageSwitcher = true,
    logo: customLogo,
    siteName: customSiteName,
    homeUrl = '/',
    showAuthButtons = true,
    showNotifications = true,
  } = props

  const { t } = useTranslation()
  const [scrolled, setScrolled] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [mobileOpen, setMobileOpen] = useState(false)
  const openAuthDialog = useAuthDialogStore((state) => state.openAuthDialog)
  // The user, not the whole store: selecting `auth` returns a fresh object on
  // every write, so the header would miss a sign-in that happens after mount.
  const user = useAuthStore((state) => state.auth.user)
  const {
    systemName,
    logo: systemLogo,
    loading,
    logoLoaded,
  } = useSystemConfig()
  const dynamicLinks = useTopNavLinks()
  const notifications = useNotifications()
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  const isAuthenticated = !!user
  const displaySiteName = customSiteName || systemName
  const links = dynamicLinks.length > 0 ? dynamicLinks : navLinks

  let logoContent: ReactNode = (
    <HeaderLogo
      src={systemLogo}
      loading={loading}
      logoLoaded={logoLoaded}
      className='size-full rounded-lg object-contain'
    />
  )
  if (customLogo) logoContent = customLogo
  if (loading) logoContent = <Skeleton className='size-full rounded-lg' />

  let authContent = (
    <Button
      size='sm'
      className='h-8 rounded-lg px-3.5 text-xs font-medium'
      onClick={() => openAuthDialog('sign-in')}
    >
      {t('Sign in')}
    </Button>
  )
  if (isAuthenticated) {
    authContent = <ProfileDropdown />
  }
  if (loading) authContent = <Skeleton className='h-8 w-20 rounded-lg' />

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 8)
      const scrollable =
        document.documentElement.scrollHeight - window.innerHeight
      setScrollProgress(
        scrollable > 0 ? Math.min(window.scrollY / scrollable, 1) : 0
      )
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  // A menu entry is current when the page sits under any of its children.
  const isCurrent = useCallback(
    (link: TopNavLink) => {
      if (link.children) {
        return link.children.some(
          (child) =>
            pathname === child.href || pathname.startsWith(`${child.href}/`)
        )
      }
      return pathname === link.href
    },
    [pathname]
  )

  const handleNavLinkClick = useCallback(
    (
      event: React.MouseEvent<HTMLAnchorElement>,
      link: TopNavLink,
      closeMobile = false
    ) => {
      if (link.disabled) {
        event.preventDefault()
        return
      }

      if (link.requiresAuth) {
        event.preventDefault()
        if (closeMobile) {
          setMobileOpen(false)
        }
        openAuthDialog('sign-in', link.href)
        return
      }

      if (closeMobile) {
        setMobileOpen(false)
      }
    },
    [openAuthDialog]
  )

  const linkClassName = (current: boolean, disabled?: boolean) =>
    cn(
      'relative inline-flex h-9 min-w-0 items-center gap-1 truncate rounded-md px-3 text-sm font-medium transition-colors duration-150',
      current
        ? 'text-foreground after:bg-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5'
        : 'text-muted-foreground hover:text-foreground',
      disabled && 'pointer-events-none opacity-50'
    )

  return (
    <>
      <header className='fixed inset-x-0 top-0 z-50'>
        <div
          className={cn(
            'border-b transition-colors duration-200',
            scrolled
              ? 'border-border bg-background/80 backdrop-blur-xl'
              : 'border-transparent bg-background'
          )}
        >
          {/* Reading progress. Two pixels of brand red, drawn as the page
              scrolls, so the bar never has to move to show where you are. */}
          <div
            aria-hidden='true'
            className='bg-primary absolute inset-x-0 top-0 h-0.5 origin-left'
            style={{ transform: `scaleX(${scrollProgress})` }}
          />
          <nav className='mx-auto flex h-14 max-w-[1408px] items-center gap-2 px-4 md:px-6'>
            {/* Logo */}
            <div className='@container/system-brand flex min-w-0 items-center gap-1 lg:min-w-36'>
              <Link
                to={homeUrl}
                className='group flex min-w-0 items-center gap-2.5'
              >
                <div className='flex size-7 shrink-0 items-center justify-center transition-all duration-300 group-hover:scale-105'>
                  {logoContent}
                </div>
                <span
                  className='max-w-48 truncate text-sm font-semibold tracking-tight'
                  title={displaySiteName}
                >
                  {loading ? (
                    <Skeleton className='h-4 w-16' />
                  ) : (
                    displaySiteName
                  )}
                </span>
              </Link>
            </div>

            {/* Desktop nav */}
            <div className='hidden min-w-0 items-center gap-0.5 lg:flex'>
              {links.map((link) => {
                const current = isCurrent(link)
                if (link.children) {
                  return (
                    <DropdownMenu key={link.title}>
                      <DropdownMenuTrigger
                        className={linkClassName(current)}
                        aria-label={t(link.title)}
                      >
                        {t(link.title)}
                        <ChevronDown className='size-3.5' aria-hidden='true' />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='start' className='w-72 p-1.5'>
                        {link.children.map((child) => (
                          <DropdownMenuItem
                            key={child.href}
                            className='items-start gap-3 p-2.5'
                            render={<Link to={child.href} />}
                          >
                            <span
                              aria-hidden='true'
                              className={cn(
                                'mt-1.5 size-1.5 shrink-0 rounded-full',
                                child.accent ? 'bg-brand-accent' : 'bg-primary'
                              )}
                            />
                            <span className='flex min-w-0 flex-col gap-0.5'>
                              <span className='text-sm font-medium'>
                                {child.title}
                              </span>
                              {child.description && (
                                <span className='text-muted-foreground text-xs leading-relaxed'>
                                  {child.description}
                                </span>
                              )}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )
                }
                if (link.external) {
                  return (
                    <a
                      key={`${link.title}:${link.href}`}
                      href={link.href}
                      title={t(link.title)}
                      target='_blank'
                      rel='noopener noreferrer'
                      aria-disabled={link.disabled}
                      tabIndex={link.disabled ? -1 : undefined}
                      onClick={(event) => handleNavLinkClick(event, link)}
                      className={linkClassName(false, link.disabled)}
                    >
                      {t(link.title)}
                    </a>
                  )
                }
                return (
                  <Link
                    key={`${link.title}:${link.href}`}
                    to={link.href}
                    title={t(link.title)}
                    disabled={link.disabled}
                    onClick={(event) => handleNavLinkClick(event, link)}
                    className={linkClassName(current, link.disabled)}
                  >
                    {t(link.title)}
                  </Link>
                )
              })}
            </div>

            {/* Spacer — pushes the right cluster to the content edge */}
            <div className='flex-1' />

            {/* Desktop right cluster */}
            <div className='hidden min-w-0 items-center gap-0.5 lg:flex'>
              {(showLanguageSwitcher ||
                showThemeSwitch ||
                showNotifications) && (
                <div className='bg-border/40 mx-2 h-4 w-px' />
              )}

              {showLanguageSwitcher && <LanguageSwitcher />}
              {showThemeSwitch && <ThemeSwitch />}
              {showNotifications && (
                <NotificationPopover
                  open={notifications.popoverOpen}
                  onOpenChange={notifications.setPopoverOpen}
                  unreadCount={notifications.unreadCount}
                  activeTab={notifications.activeTab}
                  onTabChange={notifications.setActiveTab}
                  notice={notifications.notice}
                  announcements={notifications.announcements}
                  loading={notifications.loading}
                />
              )}

              {showAuthButtons && (
                <>
                  <div className='bg-border/40 mx-1 h-4 w-px' />
                  <div className='flex items-center gap-3'>{authContent}</div>
                </>
              )}
            </div>

            {/* Mobile: compact actions + hamburger */}
            <div className='flex shrink-0 items-center gap-2 lg:hidden'>
              {showThemeSwitch && <ThemeSwitch />}
              {showAuthButtons && !loading && isAuthenticated && (
                <ProfileDropdown />
              )}
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-9'
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={t('Toggle navigation menu')}
              >
                <div className='relative size-4'>
                  <span
                    className={cn(
                      'absolute inset-x-0 block h-[1.5px] origin-center rounded-full bg-current transition-all duration-300',
                      mobileOpen ? 'top-[7px] rotate-45' : 'top-[3px]'
                    )}
                  />
                  <span
                    className={cn(
                      'absolute inset-x-0 top-[7px] block h-[1.5px] rounded-full bg-current transition-all duration-300',
                      mobileOpen ? 'scale-x-0 opacity-0' : 'opacity-100'
                    )}
                  />
                  <span
                    className={cn(
                      'absolute inset-x-0 block h-[1.5px] origin-center rounded-full bg-current transition-all duration-300',
                      mobileOpen ? 'top-[7px] -rotate-45' : 'top-[11px]'
                    )}
                  />
                </div>
              </Button>
            </div>
          </nav>
        </div>
      </header>

      {/* Mobile full-screen overlay */}
      <div
        className={cn(
          'bg-background/98 fixed inset-0 z-40 backdrop-blur-2xl transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] lg:pointer-events-none lg:hidden',
          mobileOpen
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0'
        )}
      >
        <div className='flex h-full flex-col justify-between px-8 pt-20 pb-10'>
          <nav className='flex flex-col gap-1'>
            {links.map((link) => {
              const current = isCurrent(link)
              const mobileItemClassName = cn(
                'flex items-center gap-3 py-3 text-base font-medium tracking-tight',
                current ? 'text-foreground' : 'text-muted-foreground',
                link.disabled && 'pointer-events-none opacity-50'
              )
              if (link.children) {
                return (
                  <div key={link.title} className='flex flex-col'>
                    <span className='text-muted-foreground py-3 text-xs font-medium tracking-widest uppercase'>
                      {t(link.title)}
                    </span>
                    {link.children.map((child) => (
                      <Link
                        key={child.href}
                        to={child.href}
                        onClick={() => setMobileOpen(false)}
                        className='flex flex-col gap-0.5 py-2 pl-1'
                      >
                        <span className='flex items-center gap-2 text-base font-medium'>
                          <span
                            aria-hidden='true'
                            className={cn(
                              'size-1.5 rounded-full',
                              child.accent ? 'bg-brand-accent' : 'bg-primary'
                            )}
                          />
                          {child.title}
                        </span>
                        {child.description && (
                          <span className='text-muted-foreground pl-3.5 text-xs'>
                            {child.description}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                )
              }
              if (link.external) {
                return (
                  <a
                    key={`${link.title}:${link.href}`}
                    href={link.href}
                    target='_blank'
                    rel='noopener noreferrer'
                    aria-disabled={link.disabled}
                    tabIndex={link.disabled ? -1 : undefined}
                    onClick={(event) => handleNavLinkClick(event, link, true)}
                    className={mobileItemClassName}
                  >
                    {t(link.title)}
                  </a>
                )
              }
              return (
                <Link
                  key={`${link.title}:${link.href}`}
                  to={link.href}
                  disabled={link.disabled}
                  onClick={(event) => handleNavLinkClick(event, link, true)}
                  className={mobileItemClassName}
                >
                  {t(link.title)}
                </Link>
              )
            })}
          </nav>

          <div className='flex flex-col gap-3'>
            {showAuthButtons && !isAuthenticated && (
              <button
                type='button'
                onClick={() => {
                  setMobileOpen(false)
                  openAuthDialog('sign-in')
                }}
                className='bg-foreground text-background inline-flex h-10 items-center justify-center rounded-lg text-sm font-medium transition-opacity hover:opacity-90 active:opacity-80'
              >
                {t('Sign in')}
              </button>
            )}
          </div>
        </div>
      </div>

      <AuthDialogs />
    </>
  )
}
