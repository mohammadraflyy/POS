import type { LucideIcon } from 'lucide-react'

export type UserRole = 'admin' | 'kasir'

export interface AuthUser {
  id: number
  username: string
  name: string
  role: UserRole
}

export interface NavItem {
  title: string
  href: string
  icon?: LucideIcon
  disabled?: boolean
}

export interface BreadcrumbItem {
  title: string
  href?: string
}
