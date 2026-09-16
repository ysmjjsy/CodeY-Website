import { defaultLocale, type Locale, type UiKey, ui } from './ui'

export function isLocale(value: string | undefined): value is Locale {
  return value === 'zh-CN' || value === 'en'
}

export function t(locale: Locale, key: UiKey): string {
  return ui[locale][key] ?? ui[defaultLocale][key]
}

/** Home path for a locale (zh-CN is unprefixed root). */
export function homePath(locale: Locale): string {
  return locale === 'en' ? '/en/' : '/'
}

/** Docs path prefix for a locale. */
export function docsBase(locale: Locale): string {
  return locale === 'en' ? '/en/docs' : '/docs'
}

export function docsPath(locale: Locale, slug: string): string {
  const clean = slug.replace(/^\/+|\/+$/g, '')
  return `${docsBase(locale)}/${clean}/`
}

/** Marketplace path for a locale (zh-CN is unprefixed). */
export function marketPath(locale: Locale, slug = ''): string {
  const base = locale === 'en' ? '/en/market' : '/market'
  const clean = slug.replace(/^\/+|\/+$/g, '')
  return clean ? `${base}/${clean}/` : `${base}/`
}

export function modelsPath(locale: Locale): string {
  return locale === 'en' ? '/en/models/' : '/models/'
}

export function pricingPath(locale: Locale): string {
  return locale === 'en' ? '/en/pricing/' : '/pricing/'
}

export function downloadPath(locale: Locale): string {
  return locale === 'en' ? '/en/download/' : '/download/'
}

export function registerPath(locale: Locale): string {
  return locale === 'en' ? '/en/register/' : '/register/'
}

export function consolePath(
  locale: Locale,
  section:
    | 'profile'
    | 'templates'
    | 'users'
    | 'reviews'
    | 'models'
    | 'plans'
    | 'topups' = 'profile',
): string {
  const base = locale === 'en' ? '/en/console' : '/console'
  return section === 'profile' ? `${base}/` : `${base}/${section}/`
}

/** Counterpart landing path when switching language. */
export function switchLocalePath(locale: Locale): string {
  return locale === 'en' ? '/' : '/en/'
}

/**
 * Counterpart path for the same page in the other locale, derived from the
 * current pathname so no page has to hand-maintain its own alternate href
 * (hand-maintained copies are how the two locale trees drifted apart).
 *
 * zh-CN is unprefixed, en is prefixed with `/en`:
 *   ('zh-CN', '/pricing/')     -> '/en/pricing/'
 *   ('en',     '/en/pricing/') -> '/pricing/'
 *   ('en',     '/en/')         -> '/'
 */
export function alternateLocalePath(locale: Locale, pathname: string): string {
  if (locale === 'en') {
    const stripped = pathname.replace(/^\/en(\/|$)/, '$1')
    return stripped === '' ? '/' : stripped
  }
  return pathname === '/' ? '/en/' : `/en${pathname}`
}
