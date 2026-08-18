import type { Metadata } from 'next'
import { Noto_Sans, Noto_Sans_Ethiopic, Noto_Sans_Mono } from 'next/font/google'
import './globals.css'

/**
 * Latin + Ethiopic. The Ethiopic face is required, not decorative: Amharic is a first-class
 * locale for the UI and for printed documents (M06). Loading it here means the same font
 * stack is used on screen and in PDFs.
 */
const sans = Noto_Sans({
  variable: '--font-sans',
  subsets: ['latin'],
  display: 'swap',
})

const ethiopic = Noto_Sans_Ethiopic({
  variable: '--font-ethiopic',
  subsets: ['ethiopic'],
  display: 'swap',
})

const mono = Noto_Sans_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'EthioStar CPMS',
    template: '%s · EthioStar CPMS',
  },
  description: 'Coffee Processing Management System',
  // This is an operational system behind a login; it must never be indexed.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      // EthioStar is a light product. Without this the interface follows whatever the
      // operator's laptop is set to, so the same screen is dark on one desk and light on the
      // next — see the @custom-variant note in globals.css. `colorScheme` tells the browser
      // to render its own furniture (scrollbars, form controls, autofill) light to match.
      data-theme="light"
      style={{ colorScheme: 'light' }}
      className={`${sans.variable} ${ethiopic.variable} ${mono.variable} h-full antialiased`}
    >
      {/* Colour comes from the tokens in src/ui/styles/tokens.css, never from a utility here.
          A hardcoded `bg-white` on the body wins over the base layer and silently defeats
          the whole semantic surface system. */}
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  )
}
