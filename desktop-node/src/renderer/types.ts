import type { LucideIcon } from 'lucide-react'

export interface AuthUser {
  id: number
  username: string
  name: string
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
