import type { Metadata } from 'next'
import { LoginForm } from './LoginForm'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage(props: PageProps<'/login'>) {
  const params = await props.searchParams
  const raw = params.next
  const next = typeof raw === 'string' && raw.startsWith('/') ? raw : undefined

  return <LoginForm {...(next ? { next } : {})} />
}
