/// <reference types="vite/client" />

import type { AuthUser } from './types'

declare global {
  interface Window {
    api: {
      auth: {
        login: (username: string, password: string) => Promise<AuthUser>
        logout: () => Promise<void>
        me: () => Promise<AuthUser | null>
      }
    }
  }
}

export {}
