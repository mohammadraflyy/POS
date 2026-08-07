import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import type { AuthUser } from '../types'

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function NavUser({ user }: { user: AuthUser }) {
  const navigate = useNavigate()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="cursor-default hover:bg-transparent">
          <div className="bg-sidebar-accent flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium">
            {initials(user.name)}
          </div>
          <span className="truncate">{user.name}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={async () => {
            await window.api.auth.logout()
            navigate('/login')
          }}
        >
          Keluar
        </Button>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
