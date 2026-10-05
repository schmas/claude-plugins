import type { Register } from 'claude-code'

import { registerPanel } from './panel'

export const register: Register = on => {
  registerPanel(on)
}
