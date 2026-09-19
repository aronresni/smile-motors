import { ROLES, ROUTES, type Role } from '@/lib/constants'

export interface NavItem {
  label: string
  href: string
}

/** Navegación por rol. Se ampliará cuando existan los módulos de negocio. */
export const NAVIGATION: Record<Role, NavItem[]> = {
  [ROLES.SELLER]: [{ label: 'Panel', href: ROUTES.seller }],
  [ROLES.ADMIN]: [{ label: 'Panel', href: ROUTES.admin }],
}
