import type { NextConfig } from 'next'

/**
 * See docs/architecture/09-operations.md §9.2 for the rationale behind each option.
 *
 * `cacheComponents` is deliberately NOT enabled: CPMS is an operational system where a stale
 * stock figure is a commercial dispute. See docs/adr/0009-caching-posture.md.
 */
const nextConfig: NextConfig = {
  // Pin the workspace root. Without it Turbopack walks up looking for a lockfile, finds an
  // unrelated one outside the repository, and warns on every start.
  turbopack: {
    root: __dirname,
  },

  // Small production image; no node_modules copy. Disable when deploying to Vercel.
  output: process.env.VERCEL ? undefined : 'standalone',

  // Stable in Next 16 — catches broken internal links at build time.
  typedRoutes: true,

  poweredByHeader: false,
  reactStrictMode: true,

  // Packages that must not be bundled into the server build.
  // `@react-pdf/renderer` and `nodemailer` both reach for Node built-ins and load font and
  // certificate files from disk at runtime; bundling either breaks those lookups.
  serverExternalPackages: ['postgres', '@react-pdf/renderer', 'nodemailer'],

  images: {
    // No remote images in Phase 1. `images.domains` is deprecated in Next 16; use remotePatterns.
    remotePatterns: [],
  },

  experimental: {
    serverActions: {
      // MANDATORY behind a reverse proxy: Next compares Origin against Host and rejects
      // Server Actions when they disagree. Without this, every action fails in production
      // while working perfectly in local development.
      allowedOrigins: process.env.SERVER_ACTIONS_ALLOWED_ORIGINS
        ? process.env.SERVER_ACTIONS_ALLOWED_ORIGINS.split(',').map((s) => s.trim())
        : [],
    },
  },
}

export default nextConfig
