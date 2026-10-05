import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput, Timer } from 'claude-code'

import type { CleanViewChecklist, CleanViewMode, CleanViewPhase, CleanViewTask } from '../types'

type Engine = EngineInterface

const PLAN_TOOL = 'mcp__clean-view__plan_steps'
const PROGRESS_TOOL = 'mcp__clean-view__report_progress'
const STORE_KEY = 'cleanViewMode'
/** The on/off value saved before the both mode existed. */
const LEGACY_STORE_KEY = 'cleanViewEnabled'
const SECTION_ID = 'clean-view:checklist'

const MAX_NAME = 40
const FALLBACK_NAME = 'Working on it'
const METER_CELLS = 10
const FRAME_MS = 250
const COLLAPSE_MS = 5000
const FAIL_LIMIT = 3
const MIN_STEPS = 2
const MAX_STEPS = 8

const ALWAYS_ALLOWED = new Set([
  'ToolSearch',
  'TodoWrite',
  'TaskCreate',
  'TaskUpdate',
  'AskUserQuestion',
  PLAN_TOOL,
])

const PLACEHOLDER_STEPS = ['Understand your request', 'Plan the steps']

const NEEDS_OK = 'Claude needs your OK to continue'
const HAS_QUESTION = 'Claude has a question for you'
const WAITING_REPLY = 'Claude is waiting for your reply'
const SAID_NO = 'you said no to a step, so Claude paused'
const KEEPS_FAILING = 'a step keeps failing, Claude is trying another way'
const REFUSED = "Claude couldn't help with that request"
const API_USAGE = 'you hit your usage limit, try again a little later'
const API_BUSY = "Claude's servers are busy, try again in a minute"
const API_TOO_LONG = 'type /compact and try again'
const API_NETWORK = 'the internet connection dropped'
const API_AUTH = 'type /login'
const API_OTHER = 'something went wrong talking to Claude, try again'

const USER_SAID_NO = /doesn't want to proceed|tool use was rejected/i

const GATE_MESSAGE =
  `Clean View: call ${PLAN_TOOL} first to lay out the steps of this job in plain English ` +
  '(load it with ToolSearch if it is deferred). Then try this tool again.'

const CODE_EXTENSIONS =
  'tsx?|jsx?|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|kts|swift|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|fish|ps1|' +
  'json|jsonc|ya?ml|toml|ini|env|lock|md|mdx|html?|css|scss|sass|less|sql|vue|svelte|xml|gradle|tf|dart|lua|r'
const FILE_NAME = new RegExp(`^[("'\\[]*[\\w.-]+\\.(${CODE_EXTENSIONS})[)"'\\],.:;!?]*$`, 'i')

const EMPTY: CleanViewChecklist = {
  title: '',
  phase: 'idle',
  tasks: [],
  needsYouReason: null,
  stuckReason: null,
  startedAt: null,
  finishedAt: null,
  isCollapsed: false,
  isPlanned: false,
}

const MODES: readonly CleanViewMode[] = ['on', 'both', 'off']

const MODE_LABEL: Record<CleanViewMode, string> = {
  on: '● Clean View: ON',
  both: '◐ Clean View: BOTH',
  off: '○ Clean View: OFF',
}

const MODE_TOAST: Record<CleanViewMode, string> = {
  on: 'Clean View is on. Technical details are hidden.',
  both: 'Clean View is on. You see the checklist and every detail.',
  off: 'Clean View is off. You see every detail again.',
}

const MODE_REPLY: Record<CleanViewMode, string> = {
  on: 'Clean View is on.',
  both: 'Clean View is on, with every detail shown.',
  off: 'Clean View is off.',
}

const mode = atom({ plugin: 'clean-view', key: 'mode' } as const, 'on' as CleanViewMode)
const checklist = atom({ plugin: 'clean-view', key: 'checklist' } as const, EMPTY)
const tick = atom({ plugin: 'clean-view', key: 'tick' } as const, 0)

/** Turns any step or job name into short plain English with no code in it. */
export function cleanName(raw: string): string {
  const words = raw
    .replace(/`[^`]*`/g, ' ')
    .replace(/`/g, ' ')
    .split(/\s+/)
    .filter(word => word !== '' && !word.includes('/') && !word.includes('\\') && !FILE_NAME.test(word))
  const text = words.join(' ').replace(/\s+/g, ' ').trim()

  if (text === '') {
    return FALLBACK_NAME
  }

  const named = text[0]!.toUpperCase() + text.slice(1)

  if (named.length <= MAX_NAME) {
    return named
  }

  const head = named.slice(0, MAX_NAME - 1)
  const space = head.lastIndexOf(' ')
  const cut = (space > 0 ? head.slice(0, space) : head).replace(/[\s,.;:!?-]+$/, '')

  return `${cut}…`
}

function jobTitle(raw: string): string {
  const firstLine = raw.split('\n').find(line => line.trim() !== '') ?? ''
  const words = cleanName(firstLine.replace(/["'*_#.]/g, ' ')).replace(/…$/, '').split(' ')

  return cleanName(words.slice(0, 6).join(' '))
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

function clampPercent(value: unknown): number {
  const number = Number(value)

  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : 0
}

function isMode(value: unknown): value is CleanViewMode {
  return MODES.includes(value as CleanViewMode)
}

function nextMode(current: CleanViewMode): CleanViewMode {
  return MODES[(MODES.indexOf(current) + 1) % MODES.length]!
}

/** The checklist runs in `on` and `both`. */
async function isTracking($: Engine): Promise<boolean> {
  return (await read($, mode)) !== 'off'
}

/** Tool rows are hidden only in `on`; `both` keeps them next to the checklist. */
async function isHiding($: Engine): Promise<boolean> {
  return (await read($, mode)) === 'on'
}

function isRunning(phase: CleanViewPhase): boolean {
  return phase === 'working' || phase === 'needsYou' || phase === 'stuck'
}

function task(id: string, name: string, status: CleanViewTask['status']): CleanViewTask {
  const isDone = status === 'done'

  return { id, name, status, percent: isDone ? 100 : 0, hasReported: isDone }
}

function finishAll(tasks: CleanViewTask[]): CleanViewTask[] {
  return tasks.map(one => ({ ...one, status: 'done', percent: 100, hasReported: true }))
}

/** Checks off every step before `index`, sets that step's percent and starts the next one at 100. */
function reportAt(tasks: CleanViewTask[], index: number, percent: number): CleanViewTask[] {
  const isFinished = percent >= 100
  const reported = tasks.map((one, at): CleanViewTask => {
    if (at < index) {
      return { ...one, status: 'done', percent: 100, hasReported: true }
    }

    if (at === index) {
      return { ...one, status: isFinished ? 'done' : 'active', percent, hasReported: true }
    }

    return one.status === 'active' ? { ...one, status: 'upcoming', percent: 0, hasReported: false } : one
  })

  if (!isFinished) {
    return reported
  }

  const following = reported.findIndex((one, at) => at > index && one.status === 'upcoming')

  return following < 0
    ? reported
    : reported.map((one, at) => (at === following ? { ...one, status: 'active', percent: 0, hasReported: false } : one))
}

function applyProgress(tasks: CleanViewTask[], rawName: string, percent: number): CleanViewTask[] {
  const name = cleanName(rawName)
  const found = tasks.findIndex(one => one.name.toLowerCase() === name.toLowerCase())

  if (found >= 0) {
    return reportAt(tasks, found, percent)
  }

  // An unplanned step lands where the current step is, so nothing is checked off by mistake.
  const active = tasks.findIndex(one => one.status === 'active')
  const at = active >= 0 ? active : tasks.filter(one => one.status === 'done').length
  const added = [...tasks.slice(0, at), task(`extra-${tasks.length + 1}`, name, 'upcoming'), ...tasks.slice(at)]

  return reportAt(added, at, percent)
}

function todoStatus(status: unknown): CleanViewTask['status'] {
  if (status === 'completed') {
    return 'done'
  }

  return status === 'in_progress' ? 'active' : 'upcoming'
}

function apiReason(kind: string, details: string): string {
  const text = `${kind} ${details}`

  if (/rate_limit|billing|usage limit|429/i.test(text)) {
    return API_USAGE
  }

  if (/overloaded|server_error|529|50\d/i.test(text)) {
    return API_BUSY
  }

  if (/too long|context|too many tokens|max_output_tokens/i.test(text)) {
    return API_TOO_LONG
  }

  if (/authentication|oauth|credential|verification|401|403|\/login|api key/i.test(text)) {
    return API_AUTH
  }

  if (/network|connection|connect|econn|enotfound|fetch failed|socket|offline|timed? ?out/i.test(text)) {
    return API_NETWORK
  }

  return API_OTHER
}

function guide(tools: readonly string[]): string {
  const hasTodos = tools.includes('TodoWrite') || tools.includes('TaskCreate')
  const lines = [
    '# Clean View',
    'The person sees a simple checklist of your work instead of tool calls. Keep it accurate.',
    '- Write every step name in plain English a non-technical person understands. Keep it under 40 characters and start it with a verb, like "Build the pricing section".',
    '- Never put file paths, file names, commands, code or tool names in a step name.',
    `- For every request, even a quick question, call ${PLAN_TOOL} first with 2 to 8 short steps in order. Load it with ToolSearch if it is deferred. Other tools are blocked until a plan exists.`,
    `- Then call ${PROGRESS_TOOL} as real progress happens, and with percent 100 the moment a step finishes.`,
  ]

  if (hasTodos) {
    lines.push('- You can use your to-do list (TodoWrite or TaskCreate) as the plan instead; the same naming rules apply.')
  }

  return lines.join('\n')
}

function padEnd(text: string, width: number): string {
  if (width <= 0) {
    return ''
  }

  const chars = [...text]

  if (chars.length > width) {
    return `${chars.slice(0, Math.max(0, width - 1)).join('')}…`
  }

  return text + ' '.repeat(width - chars.length)
}

function meter(one: CleanViewTask, frame: number): string {
  if (one.status === 'done') {
    return '█'.repeat(METER_CELLS)
  }

  if (one.status === 'upcoming') {
    return '░'.repeat(METER_CELLS)
  }

  if (!one.hasReported) {
    const cells = Array.from({ length: METER_CELLS }, (_, at) => {
      const distance = (at - (frame % (METER_CELLS + 3)) + METER_CELLS + 3) % (METER_CELLS + 3)

      return distance < 3 ? '▓' : '░'
    })

    return cells.join('')
  }

  const filled = Math.round(one.percent / 10)

  return '█'.repeat(filled) + '░'.repeat(METER_CELLS - filled)
}

let frameTimer: Timer | null = null
let failures = 0
let lastApiError: { kind: string; details: string } | null = null

function syncClock($: Engine, list: CleanViewChecklist): void {
  const shouldAnimate = list.phase === 'working' || list.phase === 'needsYou'

  if (shouldAnimate && frameTimer === null) {
    frameTimer = $.clock.every(FRAME_MS, () => {
      void update($, tick, frame => frame + 1)
    })
  }

  if (!shouldAnimate && frameTimer !== null) {
    frameTimer.cancel()
    frameTimer = null
  }
}

async function change($: Engine, fn: (list: CleanViewChecklist) => CleanViewChecklist): Promise<CleanViewChecklist> {
  const list = await update($, checklist, fn)
  syncClock($, list)

  return list
}

async function startJob($: Engine, title: string): Promise<CleanViewChecklist> {
  const now = await $.clock.now()
  failures = 0
  lastApiError = null

  return change($, () => ({
    ...EMPTY,
    title,
    phase: 'working',
    tasks: PLACEHOLDER_STEPS.map((name, at) => task(`placeholder-${at + 1}`, name, at === 0 ? 'active' : 'upcoming')),
    startedAt: now,
  }))
}

async function ensureJob($: Engine): Promise<void> {
  const list = await read($, checklist)

  if (!isRunning(list.phase)) {
    await startJob($, FALLBACK_NAME)
  }
}

async function nameJob($: Engine, prompt: string, startedAt: number | null): Promise<void> {
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      effort: 'low',
      maxTokens: 40,
      timeoutMs: 15000,
      system:
        'Name the request as a job title a non-technical person understands: 2 to 6 plain English words that start with a verb, like "Build my landing page". No file names, paths, code or quotes. Reply with the title only.',
      prompt: prompt.slice(0, 4000),
    })

    if (!reply.isAnswered) {
      return
    }

    const title = jobTitle(reply.text)
    await update($, checklist, list => (list.startedAt === startedAt ? { ...list, title } : list))
  } catch {
    // The header keeps its fallback name.
  }
}

async function setStuck($: Engine, reason: string): Promise<void> {
  await change($, list => (isRunning(list.phase) ? { ...list, phase: 'stuck', stuckReason: reason, needsYouReason: null } : list))
}

async function setNeedsYou($: Engine, reason: string): Promise<void> {
  await ensureJob($)
  await change($, list => ({ ...list, phase: 'needsYou', needsYouReason: reason }))
}

async function resume($: Engine): Promise<void> {
  await change($, list =>
    list.phase === 'needsYou' || list.phase === 'stuck'
      ? { ...list, phase: 'working', needsYouReason: null, stuckReason: null }
      : list,
  )
}

async function setMode($: Engine, value: CleanViewMode): Promise<void> {
  await update($, mode, () => value)
  await $.store.set(STORE_KEY, value)
  $.ui.toast(MODE_TOAST[value])
}

async function storedMode($: Engine): Promise<CleanViewMode> {
  const stored = await $.store.get(STORE_KEY)

  if (isMode(stored)) {
    return stored
  }

  const legacy = await $.store.get(LEGACY_STORE_KEY)

  return legacy === false ? 'off' : 'on'
}

async function planSteps($: Engine, input: Record<string, unknown>) {
  const raw = Array.isArray(input.steps) ? input.steps : []
  const steps = raw.map(step => cleanName(String(step))).slice(0, MAX_STEPS)

  if (steps.length < MIN_STEPS) {
    return { deny: `Give ${MIN_STEPS} to ${MAX_STEPS} short step names, in order.` }
  }

  await ensureJob($)
  await change($, list => ({
    ...list,
    phase: list.phase === 'stuck' ? 'working' : list.phase,
    stuckReason: list.phase === 'stuck' ? null : list.stuckReason,
    tasks: steps.map((name, at) => task(`step-${at + 1}`, name, at === 0 ? 'active' : 'upcoming')),
    isPlanned: true,
    isCollapsed: false,
  }))

  return { result: `Planned ${steps.length} steps. The first one has started.` }
}

async function reportProgress($: Engine, input: Record<string, unknown>) {
  const percent = clampPercent(input.percent)
  await ensureJob($)
  await change($, list => ({ ...list, tasks: applyProgress(list.tasks, String(input.task ?? ''), percent) }))

  return { result: `Progress noted: ${percent}%.` }
}

async function trackTodos($: Engine, input: Record<string, unknown>): Promise<void> {
  if (!Array.isArray(input.todos)) {
    return
  }

  const todos = input.todos as Array<Record<string, unknown>>
  await ensureJob($)
  await change($, list => ({
    ...list,
    isPlanned: list.isPlanned || todos.length > 0,
    tasks: todos.map((todo, at) => {
      const name = cleanName(String(todo.content ?? todo.activeForm ?? ''))
      const status = todoStatus(todo.status)
      const before = list.tasks.find(one => one.name === name && one.status === 'active')

      return status === 'active' && before !== undefined
        ? { ...before, id: `todo-${at + 1}` }
        : task(`todo-${at + 1}`, name, status)
    }),
  }))
}

async function trackTaskCreate($: Engine, input: Record<string, unknown>, resultText: string): Promise<void> {
  const name = cleanName(String(input.subject ?? input.description ?? ''))
  const number = /#?(\d+)/.exec(resultText)?.[1]
  await ensureJob($)
  await change($, list => {
    const kept = list.isPlanned ? list.tasks : []
    const id = `task-${number ?? kept.length + 1}`

    return { ...list, isPlanned: true, tasks: [...kept.filter(one => one.id !== id), task(id, name, 'upcoming')] }
  })
}

async function trackTaskUpdate($: Engine, input: Record<string, unknown>): Promise<void> {
  const id = `task-${String(input.taskId ?? '')}`
  const subject = typeof input.subject === 'string' ? cleanName(input.subject) : null
  await change($, list => {
    if (input.status === 'deleted') {
      return { ...list, tasks: list.tasks.filter(one => one.id !== id) }
    }

    const status = input.status === undefined ? null : todoStatus(input.status)

    return {
      ...list,
      tasks: list.tasks.map(one => {
        if (one.id !== id) {
          return one
        }

        const named = subject === null ? one : { ...one, name: subject }

        if (status === null || status === named.status) {
          return named
        }

        return status === 'active' ? { ...named, status, percent: 0, hasReported: false } : task(id, named.name, status)
      }),
    }
  })
}

async function trackOutcome($: Engine, ran: { deny?: string; isError?: true; text?: string; result?: unknown }): Promise<void> {
  const message = ran.deny ?? ran.text ?? (typeof ran.result === 'string' ? ran.result : '')

  if (USER_SAID_NO.test(message)) {
    failures = 0
    await setStuck($, SAID_NO)

    return
  }

  if (ran.deny !== undefined) {
    return
  }

  if (ran.isError === true) {
    failures += 1

    if (failures >= FAIL_LIMIT) {
      await setStuck($, KEEPS_FAILING)
    }

    return
  }

  failures = 0
  await change($, list => (list.phase === 'stuck' ? { ...list, phase: 'working', stuckReason: null } : list))
}

async function drawBand($: Engine, e: RenderInput<'AbovePrompt'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const current = await read($, mode)
  const list = await read($, checklist)
  const frame = await read($, tick)
  const now = await $.clock.now()
  const width = Math.max(20, e.props.bodyColumns)

  const toggle = <Button key="toggle" label={MODE_LABEL[current]} onPress={() => setMode($, nextMode(current))} />
  const headerRow = (left: RenderElement | null) => (
    <Box key="header" flexDirection="row" justifyContent="space-between" width={width}>
      <Box flexShrink={1}>{left ?? <Text> </Text>}</Box>
      {toggle}
    </Box>
  )

  if (current === 'off' || list.phase === 'idle') {
    return <Box flexDirection="column">{headerRow(null)}</Box>
  }

  const title = list.title || FALLBACK_NAME
  const runFor = elapsed((list.finishedAt ?? now) - (list.startedAt ?? now))
  let header: RenderElement

  switch (list.phase) {
    case 'needsYou':
      header = (
        <Text wrap="truncate">
          <Text bold inverse color="yellow"> Needs you </Text> {list.needsYouReason ?? WAITING_REPLY}
        </Text>
      )
      break
    case 'stuck':
      header = (
        <Text wrap="truncate" color="yellow">
          ⚠ Stuck: {list.stuckReason ?? KEEPS_FAILING}
        </Text>
      )
      break
    case 'stopped':
      header = (
        <Text wrap="truncate">
          <Text color="red">■ Stopped</Text> · {title} · you pressed Esc
        </Text>
      )
      break
    case 'done':
      header = (
        <Text wrap="truncate">
          <Text color="green">✓ All done</Text> · {title} · took {runFor}
        </Text>
      )
      break
    default:
      header = (
        <Text wrap="truncate">
          <Text bold>{title}</Text> · {runFor}
        </Text>
      )
  }

  if (list.phase === 'done' && list.isCollapsed) {
    return <Box flexDirection="column">{headerRow(header)}</Box>
  }

  // icon (2) + name + gap (1) + meter (10) + gap (2) + label (7)
  const nameWidth = Math.max(4, width - 2 - 1 - METER_CELLS - 2 - 7)
  const firstUpcoming = list.tasks.findIndex(one => one.status === 'upcoming')
  const rows = list.tasks.map((one, at) => {
    const name = padEnd(one.name, nameWidth)
    const bar = meter(one, frame)

    if (one.status === 'done') {
      return (
        <Box key={`row-${one.id}`} flexDirection="row">
          <Text color="green">✓ </Text>
          <Text dimColor>{name} </Text>
          <Text color="green">{bar}</Text>
          <Text dimColor>  Done</Text>
        </Box>
      )
    }

    if (one.status === 'active') {
      const icon = list.phase === 'needsYou' ? '‖ ' : '▶ '
      const label = one.hasReported ? `${one.percent}%` : 'Working'

      return (
        <Box key={`row-${one.id}`} flexDirection="row">
          <Text color="cyan">{icon}</Text>
          <Text bold>{name} </Text>
          <Text color="cyan">{bar}</Text>
          <Text>  {label}</Text>
        </Box>
      )
    }

    return (
      <Box key={`row-${one.id}`} flexDirection="row">
        <Text dimColor>○ </Text>
        <Text dimColor>{name} </Text>
        <Text dimColor>{bar}</Text>
        <Text dimColor>  {at === firstUpcoming ? 'Next' : 'Up next'}</Text>
      </Box>
    )
  })

  return (
    <Box flexDirection="column">
      {headerRow(header)}
      {rows}
    </Box>
  )
}

export function registerCleanView(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'plan_steps',
      description:
        'Lay out every step of the current job up front, in order, so the person sees a simple checklist. Call it first for every request. Each step is plain English, under 40 characters, starts with a verb, and never holds file paths, file names, commands, code or tool names.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: { type: 'string' },
            minItems: MIN_STEPS,
            maxItems: MAX_STEPS,
            description: '2 to 8 short step names, in order, like "Build the pricing section".',
          },
        },
        required: ['steps'],
      },
    })
    await $.tool.register({
      name: 'report_progress',
      description:
        'Report progress on the current step of the plan. Call it as real progress happens, and with percent 100 the moment a step finishes; the next step then starts by itself. Use the step name exactly as planned.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'The step name, as given to plan_steps.' },
          percent: { type: 'number', minimum: 0, maximum: 100, description: 'How far along the step is, 0 to 100.' },
        },
        required: ['task', 'percent'],
      },
    })
    await $.command.register({
      name: 'simple',
      description: 'Set Clean View: on hides details, both shows details and the checklist, off (no argument cycles)',
      argumentHint: 'on|both|off',
    })

    const stored = await storedMode($)
    await update($, mode, () => stored)
    syncClock($, await read($, checklist))

    return next(e)
  })

  on('command.run', { command: 'simple' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg !== '' && !isMode(arg)) {
      return { text: 'Use /simple on, /simple both, /simple off, or /simple to go to the next mode.' }
    }

    const value = arg === '' ? nextMode(await read($, mode)) : arg
    await setMode($, value)

    return { text: MODE_REPLY[value] }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    if (!(await isTracking($))) {
      return composed
    }

    const sections = composed.sections.filter(section => section.id !== SECTION_ID)

    return { ...composed, sections: [...sections, { id: SECTION_ID, text: guide(e.tools), scope: 'session' as const }] }
  })

  on('turn.start', async ($, e, next) => {
    const text = e.text.trim()

    if (text === '' || text.startsWith('/')) {
      return next(e)
    }

    const list = await read($, checklist)

    if (isRunning(list.phase)) {
      await resume($)

      return next(e)
    }

    const started = await startJob($, FALLBACK_NAME)

    if (await isTracking($)) {
      void nameJob($, text, started.startedAt)
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const isMain = e.agentId === undefined

    if (isMain && !ALWAYS_ALLOWED.has(tool) && (await isTracking($)) && !(await read($, checklist)).isPlanned) {
      return { deny: GATE_MESSAGE }
    }

    if (tool === PLAN_TOOL) {
      return planSteps($, input)
    }

    if (tool === PROGRESS_TOOL) {
      return reportProgress($, input)
    }

    if (!isMain) {
      return next(e)
    }

    if (tool === 'AskUserQuestion') {
      await setNeedsYou($, HAS_QUESTION)
    } else {
      await resume($)
    }

    const ran = await next(e)

    await change($, list => (list.phase === 'needsYou' ? { ...list, phase: 'working', needsYouReason: null } : list))

    if (ran.deny === undefined && ran.isError !== true) {
      if (tool === 'TodoWrite') {
        await trackTodos($, input)
      } else if (tool === 'TaskCreate') {
        await trackTaskCreate($, input, ran.text ?? JSON.stringify(ran.result ?? ''))
      } else if (tool === 'TaskUpdate') {
        await trackTaskUpdate($, input)
      }
    }

    await trackOutcome($, ran)

    return ran
  })

  on('classic.Notification', async ($, e, next) => {
    if (e.notification_type === 'permission_prompt') {
      await setNeedsYou($, NEEDS_OK)
    } else if (e.notification_type === 'elicitation_dialog') {
      await setNeedsYou($, HAS_QUESTION)
    }

    return next(e)
  })

  on('classic.StopFailure', async ($, e, next) => {
    lastApiError = { kind: e.error, details: e.error_details ?? e.last_assistant_message ?? '' }
    await setStuck($, apiReason(lastApiError.kind, lastApiError.details))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      return next(e)
    }

    const list = await read($, checklist)

    if (!isRunning(list.phase)) {
      return next(e)
    }

    const now = await $.clock.now()
    const apiError = lastApiError
    failures = 0
    lastApiError = null

    if (e.reason === 'error') {
      await setStuck($, apiReason(apiError?.kind ?? '', apiError?.details ?? e.answer))
    } else if (e.reason === 'refusal') {
      await setStuck($, REFUSED)
    } else if (e.reason === 'aborted') {
      await change($, current => ({ ...current, phase: 'stopped', needsYouReason: null, stuckReason: null, finishedAt: now }))
    } else if (list.isPlanned && list.tasks.some(one => one.status !== 'done')) {
      await change($, current => ({ ...current, phase: 'needsYou', needsYouReason: WAITING_REPLY, stuckReason: null }))
    } else {
      await change($, current => ({
        ...current,
        phase: 'done',
        tasks: finishAll(current.tasks),
        needsYouReason: null,
        stuckReason: null,
        finishedAt: now,
        isCollapsed: false,
      }))
      $.clock.after(COLLAPSE_MS, () => {
        void update($, checklist, current =>
          current.phase === 'done' && current.finishedAt === now ? { ...current, isCollapsed: true } : current,
        )
      })
    }

    return next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e)

    return (await isHiding($)) ? <Box display="none" /> : next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e)

    return (await isHiding($)) ? <Box display="none" /> : next(e)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const { Box } = $.ui.resolve(e)

    return (await isHiding($)) ? <Box display="none" /> : next(e)
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) =>
    (await isHiding($)) ? next({ ...e, props: { ...e.props, hint: '' } }) : next(e),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    return drawBand($, e)
  })
}
