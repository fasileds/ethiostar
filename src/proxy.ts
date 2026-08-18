import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { env } from '@config/env'
import {
  HEADER_REQUEST_ID,
  HEADER_CORRELATION_ID,
  HEADER_LOCALE,
  HEADER_CSP_NONCE,
  COOKIE_LOCALE,
  LOCALES,
  type Locale,
} from '@config/constants'

/**
 * Next.js 16 renamed `middleware` to `proxy`. Node.js runtime, not configurable.
 *
 * This runs on EVERY matched request including prefetches, so it stays cheap and does
 * OPTIMISTIC checks only. It is explicitly NOT the authorization layer — real permission
 * checks happen in the use case, next to the data (docs/adr/0011).
 *
 * Responsibilities, in order:
 *   1. request/correlation ids
 *   2. security headers + CSP nonce
 *   3. REFRESH THE SUPABASE SESSION  ← without this, a 5-minute access token expires and
 *      Server Components see a logged-out user mid-session. The single most common
 *      @supabase/ssr mistake.
 *   4. optimistic redirects from JWT claims (no database call)
 *   5. forced first-login password change
 *   6. locale resolution
 */

const PUBLIC_PATHS = ['/', '/apply', '/status']
const AUTH_PATHS = ['/login', '/forgot-password', '/reset-password', '/mfa']
const FIRST_LOGIN_PATH = '/first-login'

/** Areas that require a session. */
const STAFF_PREFIXES = [
  '/dashboard',
  '/applications',
  '/customers',
  '/delivery-requests',
  '/receiving',
  '/consignments',
  '/warehouse',
  '/stock',
  '/kesha',
  '/scheduling',
  '/processing',
  '/acceptance',
  '/dispatch',
  '/gate',
  '/labour',
  '/printing',
  '/audit',
  '/admin',
]

/**
 * The customer portal lives under one prefix.
 *
 * A single entry rather than a list of leaf paths: a list has to be edited every time a
 * portal screen is added, and the failure mode of forgetting is an UNPROTECTED page, which
 * is exactly the kind of mistake that goes unnoticed.
 */
const PORTAL_PREFIXES = ['/portal']

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/apply') ||
    pathname.startsWith('/status')
  )
}

function isAuthPath(pathname: string): boolean {
  return AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function requiresSession(pathname: string): boolean {
  const all = [...new Set([...STAFF_PREFIXES, ...PORTAL_PREFIXES])]
  return all.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function resolveLocale(request: NextRequest): Locale {
  const cookieLocale = request.cookies.get(COOKIE_LOCALE)?.value
  if (cookieLocale && (LOCALES as readonly string[]).includes(cookieLocale)) {
    return cookieLocale as Locale
  }

  const header = request.headers.get('accept-language') ?? ''
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim().toLowerCase() ?? ''
    if (tag.startsWith('am')) return 'am'
    if (tag.startsWith('en')) return 'en'
  }

  return env.DEFAULT_LOCALE
}

/**
 * Security headers.
 *
 * Two directives here are correct in production and actively break local development, so
 * they are gated rather than shipped everywhere:
 *
 *   `upgrade-insecure-requests` rewrites the application's OWN http:// navigations to
 *   https://. On localhost there is no TLS listener, so the sign-in redirect failed with
 *   "unsafe attempt to load URL https://localhost:3013/login … Domains, protocols and ports
 *   must match" and the browser refused to follow it.
 *
 *   `Strict-Transport-Security` is worse, because the browser CACHES it — a two-year policy
 *   pinned against localhost keeps forcing https long after the header stops being sent, and
 *   it is shared with every other project served from localhost on any port. HSTS is
 *   meaningless without TLS anyway; there is nothing to protect on a loopback interface.
 *
 * React's development build also needs `eval()` to reconstruct stack traces across the
 * server/client boundary. Without `'unsafe-eval'` in development the console fills with
 * "eval() is not supported in this environment" and the error overlay loses its call stacks.
 * It is never added in production, where React does not use eval at all.
 */
function securityHeaders(response: NextResponse, nonce: string): void {
  const production = env.NODE_ENV === 'production'

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? '' : " 'unsafe-eval'"}`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${env.NEXT_PUBLIC_SUPABASE_URL}`,
    // Without this, `frame-src` falls back to `default-src 'self'` and the staff document
    // preview modal (an <iframe> pointed at a signed Supabase Storage URL) gets silently
    // blocked by the browser before the request ever leaves the page.
    `frame-src 'self' ${env.NEXT_PUBLIC_SUPABASE_URL}`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ')

  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  // camera=(self) because M22's QR scanning (Phase 2) needs it and the policy should not
  // have to change for that.
  response.headers.set('Permissions-Policy', 'camera=(self), geolocation=(), microphone=()')

  if (production) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    )
  }
}

interface RequestContext {
  readonly requestId: string
  readonly nonce: string
  readonly headers: Headers
}

function buildRequestContext(request: NextRequest): RequestContext {
  const requestId = request.headers.get(HEADER_REQUEST_ID) ?? crypto.randomUUID()
  const correlationId = request.headers.get(HEADER_CORRELATION_ID) ?? requestId
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')

  const headers = new Headers(request.headers)
  headers.set(HEADER_REQUEST_ID, requestId)
  headers.set(HEADER_CORRELATION_ID, correlationId)
  headers.set(HEADER_CSP_NONCE, nonce)
  headers.set(HEADER_LOCALE, resolveLocale(request))

  return { requestId, nonce, headers }
}

/**
 * Refresh the Supabase session and return both the (possibly rebuilt) response and the
 * user. Cookies can only be written onto a response here — Server Components cannot do it,
 * which is why a missing refresh silently logs users out mid-session.
 */
async function refreshSession(
  request: NextRequest,
  ctx: RequestContext,
): Promise<{ response: NextResponse; claims: SessionClaims | null }> {
  let response = NextResponse.next({ request: { headers: ctx.headers } })

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value)
          }
          response = NextResponse.next({ request: { headers: ctx.headers } })
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options)
          }
        },
      },
    },
  )

  // getClaims(), not getUser(): the hook's claims live at the top level of the JWT, and
  // getUser() returns the stored auth.users row, which never carries them. Reading
  // `user.app_metadata` here meant must_change_password and actor_kind were always
  // undefined — so the forced password change never fired and every realm looked like
  // staff. See the note in src/server/auth/dal.ts.
  const { data } = await supabase.auth.getClaims()
  const claims = (data?.claims ?? null) as SessionClaims | null

  return { response, claims }
}

interface SessionClaims {
  readonly sub?: string
  readonly must_change_password?: boolean
  readonly actor_kind?: string
}

/** Optimistic redirect decision from JWT claims only — no database call. */
function redirectDecision(
  request: NextRequest,
  pathname: string,
  claims: SessionClaims | null,
): NextResponse | null {
  if (!claims?.sub) {
    if (requiresSession(pathname) && !isPublic(pathname)) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('next', pathname)
      return NextResponse.redirect(loginUrl)
    }
    return null
  }

  // M04: credentials issued on approval force a change before anything else.
  if (claims.must_change_password === true && pathname !== FIRST_LOGIN_PATH) {
    return NextResponse.redirect(new URL(FIRST_LOGIN_PATH, request.url))
  }

  // Home differs by realm. Sending a customer to /dashboard lands them in the staff console,
  // where every query scopes by a customer_id they do not carry — so the page renders as an
  // empty operations screen rather than as their coffee. Optimistic, from the claim only;
  // each layout re-establishes this against the database.
  const home = claims.actor_kind === 'customer' ? '/portal/dashboard' : '/dashboard'

  if (isAuthPath(pathname)) {
    return NextResponse.redirect(new URL(home, request.url))
  }

  return null
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const ctx = buildRequestContext(request)
  const { response, claims } = await refreshSession(request, ctx)

  securityHeaders(response, ctx.nonce)
  response.headers.set(HEADER_REQUEST_ID, ctx.requestId)

  const redirect = redirectDecision(request, request.nextUrl.pathname, claims)
  if (redirect) {
    securityHeaders(redirect, ctx.nonce)
    return redirect
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation. Without excluding these,
     * auth logic would run on — and could block — CSS, JS and images.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2?)$).*)',
  ],
}
