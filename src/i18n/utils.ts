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

export function consolePath(locale: Locale, section: 'credits' | 'templates' | 'reviews' | 'models' | 'plans' | 'topups' = 'credits'): string {
  const base = locale === 'en' ? '/en/console' : '/console'
  return section === 'credits' ? `${base}/` : `${base}/${section}/`
}

/** Counterpart landing path when switching language. */
export function switchLocalePath(locale: Locale): string {
  return locale === 'en' ? '/' : '/en/'
}
