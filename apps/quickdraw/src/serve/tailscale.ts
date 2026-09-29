// Who the host is on its tailnet: the login `tailscale serve` names it by when
// it opens its own boards through it, so the host is one person however it
// comes (straight to this computer, or through the tailnet). null without
// Tailscale.
import { execFileSync } from 'node:child_process'

export interface Person { login: string, name?: string }

export function tailnetSelf(): Person | null {
  try {
    const s = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }))
    const user = s?.User?.[String(s?.Self?.UserID)]
    return typeof user?.LoginName === 'string' && user.LoginName ? { login: user.LoginName, ...(user.DisplayName ? { name: String(user.DisplayName) } : {}) } : null
  } catch { return null }
}
