import type { ToolboxEffort, ToolboxPosition, ToolboxSetting, ToolboxSettingValue } from '../types'

export type ModelChoice = { alias: string; label: string }

export type EffortChoice = { level: ToolboxEffort; label: string }

export type ModelRow = { options?: readonly string[] } | undefined

export const EFFORTS: readonly EffortChoice[] = [
  { level: 'low', label: 'Low' },
  { level: 'medium', label: 'Medium' },
  { level: 'high', label: 'High' },
  { level: 'xhigh', label: 'XHigh' },
  { level: 'max', label: 'Max' },
]

/** Used only when Claude Code lists no model options. */
export const FALLBACK_MODELS: readonly ModelChoice[] = [
  { alias: 'haiku', label: 'Haiku 4.5' },
  { alias: 'sonnet', label: 'Sonnet 5.5' },
  { alias: 'opus', label: 'Opus 5.5' },
  { alias: 'fable', label: 'Fable 5.1' },
]

const KNOWN_LABELS: Record<string, string> = Object.fromEntries(FALLBACK_MODELS.map(one => [one.alias, one.label]))

/** Options of the `/model` row that are not one plain model. */
const NOT_A_MODEL = new Set(['default', 'best', 'opusplan'])

function capitalize(text: string): string {
  return text === '' ? text : text[0]!.toUpperCase() + text.slice(1)
}

/** The model chips: the `/model` row's plain model options, with friendly labels. */
export function modelChoices(row: ModelRow): ModelChoice[] {
  const aliases = (row?.options ?? []).filter(option => !NOT_A_MODEL.has(option) && !option.includes('['))

  if (aliases.length === 0) {
    return [...FALLBACK_MODELS]
  }

  // Known models from small to large, then any others in Claude Code's order.
  const rank = (alias: string) => {
    const at = FALLBACK_MODELS.findIndex(one => one.alias === alias)

    return at === -1 ? FALLBACK_MODELS.length : at
  }

  return [...aliases]
    .sort((a, b) => rank(a) - rank(b))
    .map(alias => ({ alias, label: KNOWN_LABELS[alias] ?? capitalize(alias) }))
}

/** The chip that matches the session's model id (`claude-opus-5-5` matches `opus`). */
export function activeModel(choices: readonly ModelChoice[], modelId: string): ModelChoice | null {
  const id = modelId.toLowerCase()

  return choices.find(choice => id === choice.alias || id.includes(`-${choice.alias}-`) || id.startsWith(`${choice.alias}-`)) ?? null
}

export function effortLabel(level: ToolboxEffort): string {
  return EFFORTS.find(one => one.level === level)?.label ?? level
}

export function isEffort(value: unknown): value is ToolboxEffort {
  return EFFORTS.some(one => one.level === value)
}

/** The effort an `/effort <arg>` sets, or null when the argument names no level. */
export function parseEffortArg(args: string): ToolboxEffort | null {
  const arg = args.trim().toLowerCase()

  return isEffort(arg) ? arg : null
}

/** The dim summary at the top right: `Opus 5.5 · Max`. */
export function summary(model: ModelChoice | null, modelId: string, effort: ToolboxEffort | null): string {
  const name = model?.label ?? modelId

  return effort === null ? name : `${name} · ${effortLabel(effort)}`
}

/** `TOOLBOX` → `T O O L B O X`. */
export function spaced(text: string): string {
  return text.toUpperCase().split('').join(' ')
}

/** The value a press moves a setting to. */
export function nextValue(setting: Pick<ToolboxSetting, 'kind' | 'options'>, current: ToolboxSettingValue): ToolboxSettingValue {
  if (setting.kind === 'toggle') {
    return current !== true
  }

  const options = setting.options ?? []

  if (options.length === 0) {
    return current
  }

  const at = options.indexOf(String(current))

  return options[(at + 1) % options.length]!
}

/** A setting is on unless it is false or reads `off`. */
export function isOn(value: ToolboxSettingValue): boolean {
  return typeof value === 'boolean' ? value : value.trim().toLowerCase() !== 'off'
}

/** What the control at the right end of a setting row reads. */
export function controlText(setting: Pick<ToolboxSetting, 'kind'>, value: ToolboxSettingValue): string {
  if (setting.kind === 'toggle') {
    return value === true ? '● On' : '○ Off'
  }

  return String(value)
}

export const DEFAULT_POSITION: ToolboxPosition = 'SessionMode'

export const POSITION_SETTING_ID = 'toolbox.position'

const POSITION_LABELS: Record<ToolboxPosition, string> = {
  AbovePrompt: 'Above prompt',
  SessionMode: 'In footer',
}

export function isPosition(value: unknown): value is ToolboxPosition {
  return value === 'AbovePrompt' || value === 'SessionMode'
}

/** Toolbox's own row under SETTINGS: where the button sits. */
export function positionSetting(position: ToolboxPosition): ToolboxSetting {
  return {
    id: POSITION_SETTING_ID,
    label: 'Toolbox button',
    hint: 'where it sits',
    kind: 'choice',
    options: Object.values(POSITION_LABELS),
    value: POSITION_LABELS[position],
  }
}

/** The position a row label like `Under prompt` names. */
export function positionFromLabel(label: ToolboxSettingValue): ToolboxPosition {
  const found = (Object.keys(POSITION_LABELS) as ToolboxPosition[]).find(one => POSITION_LABELS[one] === label)

  return found ?? DEFAULT_POSITION
}

export function buttonLabel(isOpen: boolean): string {
  return isOpen ? ' ◆ Toolbox ▲ ' : ' ◆ Toolbox ▼ '
}

/** Puts a new entry in place of one with the same id, or at the end. */
export function upsert<T extends { id: string }>(list: readonly T[], entry: T): T[] {
  const at = list.findIndex(one => one.id === entry.id)

  return at === -1 ? [...list, entry] : list.map((one, index) => (index === at ? entry : one))
}

