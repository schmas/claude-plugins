/** `on` hides details, `both` shows details and the checklist, `off` shows details only. */
export type CleanViewMode = 'on' | 'both' | 'off'

export type CleanViewTaskStatus = 'done' | 'active' | 'upcoming'

export type CleanViewTask = {
  id: string
  name: string
  status: CleanViewTaskStatus
  percent: number
  hasReported: boolean
}

export type CleanViewPhase = 'idle' | 'working' | 'needsYou' | 'stuck' | 'stopped' | 'done'

export type CleanViewChecklist = {
  title: string
  phase: CleanViewPhase
  tasks: CleanViewTask[]
  needsYouReason: string | null
  stuckReason: string | null
  startedAt: number | null
  finishedAt: number | null
  isCollapsed: boolean
  /** True once Claude laid out a real plan (plan_steps or a to-do list). */
  isPlanned: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'clean-view': {
      mode: CleanViewMode
      checklist: CleanViewChecklist
      tick: number
    }
  }
}
