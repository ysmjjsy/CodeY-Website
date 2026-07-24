import { defineMiddleware } from 'astro:middleware'

export const LOCALE_COOKIE = 'codey-locale'

const cookieOpts = {
  path: '/',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax' as const,
}

/**
 * Cookie + path sync for SSR / preview. Static hosting relies on the landing
 * page inline script for first-visit browser language detection.
 */
export const onRequest = defineMiddleware((context, next) => {
  if (context.isPrerendered) return next()

  const { pathname } = context.url
  const isAsset =
    pathname.startsWith('/_') ||
    pathname.startsWith('/pagefind') ||
    /\.[a-zA-Z0-9]+$/.test(pathname)

  if (isAsset) return next()

  if (pathname === '/en' || pathname.startsWith('/en/')) {
    context.cookies.set(LOCALE_COOKIE, 'en', cookieOpts)
    return next()
  }

  if (pathname === '/') {
    if (context.cookies.get(LOCALE_COOKIE)?.value === 'en') {
      return context.redirect('/en/')
    }
    return next()
  }

  if (pathname.startsWith('/docs')) {
    context.cookies.set(LOCALE_COOKIE, 'zh-CN', cookieOpts)
  }

  return next()
})
