import type { DesktopMailApi } from '@shared/ipc'

declare global {
  interface Window {
    mailApi: DesktopMailApi
  }
}
