import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'

import type { ToolboxEffort, ToolboxLaunch, ToolboxPosition, ToolboxSetting } from '../types'
import {
  DEFAULT_POSITION,
  EFFORTS,
  POSITION_SETTING_ID,
  activeModel,
  buttonLabel,
  controlText,
  isEffort,
  isOn,
  isPosition,
  modelChoices,
  nextValue,
  parseEffortArg,
  positionFromLabel,
  positionSetting,
  spaced,
  summary,
  upsert,
} from './panel-logic'
import type { EffortChoice, ModelChoice } from './panel-logic'

type Engine = EngineInterface

const ORANGE = '#E07B39'
const PURPLE = '#7C5CD6'
const GREEN = '#2E9E5B'
const GRAY = '#555555'
/** The rule under the title: darker than dim text, like a shadow. */
const SHADOW = '#3A3A3A'
const STORE_KEY = 'isOpen'
const EFFORT_STORE_KEY = 'effort'
const POSITION_STORE_KEY = 'position'
const LABEL_WIDTH = 10
const PANEL_WIDTH = 78

const IS_OPEN = { plugin: 'toolbox', key: 'isOpen' } as const
const EFFORT = { plugin: 'toolbox', key: 'effort' } as const
const isOpen = atom(IS_OPEN, false)
const effort = atom(EFFORT, null as ToolboxEffort | null)
const POSITION = { plugin: 'toolbox', key: 'position' } as const
const position = atom(POSITION, DEFAULT_POSITION as ToolboxPosition)
const sync = atom({ plugin: 'toolbox', key: 'sync' } as const, 0)
const press = atom({ plugin: 'toolbox', key: 'press' } as const, null)

/**
 * Rows other mods add through `$.toolbox`. The noun's methods have no `$` to
 * write state with, so the rows live here; a hot reload of Toolbox drops them
 * until each add-on sends its row again.
 */
let settings: ToolboxSetting[] = []
let launches: ToolboxLaunch[] = []

async function redraw($: Engine): Promise<void> {
  await update($, sync, n => (n ?? 0) + 1)
}

// A /clear starts the session's state over, and no event this mod can count on
// fires after it. So a value not written yet this session comes from the store.

async function openNow($: Engine): Promise<boolean> {
  const { value } = await $.state.get(IS_OPEN)

  return value === undefined ? (await $.store.get(STORE_KEY)) === true : value
}

async function effortNow($: Engine): Promise<ToolboxEffort | null> {
  const { value } = await $.state.get(EFFORT)

  if (value !== undefined && value !== null) {
    return value
  }

  const stored = await $.store.get(EFFORT_STORE_KEY)

  return isEffort(stored) ? stored : null
}

async function positionNow($: Engine): Promise<ToolboxPosition> {
  const { value } = await $.state.get(POSITION)

  if (value !== undefined) {
    return value
  }

  const stored = await $.store.get(POSITION_STORE_KEY)

  return isPosition(stored) ? stored : DEFAULT_POSITION
}

async function setPosition($: Engine, value: ToolboxPosition): Promise<void> {
  await update($, position, () => value)
  await $.store.set(POSITION_STORE_KEY, value)
}

async function setOpen($: Engine, value: boolean): Promise<void> {
  await update($, isOpen, () => value)
  await $.store.set(STORE_KEY, value)
}

async function seeEffort($: Engine, level: ToolboxEffort | null): Promise<void> {
  if (level !== null && (await read($, effort)) !== level) {
    await update($, effort, () => level)
    await $.store.set(EFFORT_STORE_KEY, level)
  }
}

async function chooseModel($: Engine, choice: ModelChoice): Promise<void> {
  const result = await $.config.set({ key: 'model', value: choice.alias })
  await redraw($)

  if ('deny' in result) {
    $.ui.toast(`Model did not change: ${String(result.deny)}`)

    return
  }

  $.ui.toast(`Model changed to ${choice.label}`)
}

async function chooseEffort($: Engine, choice: EffortChoice): Promise<void> {
  await $.command.run({ command: 'effort', args: choice.level })
  await seeEffort($, choice.level)
  $.ui.toast(`Effort changed to ${choice.label}`)
}

/** Tells the add-on that owns `id`: it hooks `state.set` on `toolbox.press`. */
async function pressAddon($: Engine, id: string, value: ToolboxSetting['value'] | null): Promise<void> {
  await update($, press, last => ({ id, value, count: (last?.count ?? 0) + 1 }))
  await redraw($)
}

async function drawButton($: Engine, e: RenderInput<'AbovePrompt' | 'PromptHint'>): Promise<RenderElement> {
  const { Button } = $.ui.resolve(e)
  const open = await openNow($)

  return <Button key="toolbox" plain label={buttonLabel(open)} onPress={() => setOpen($, !open)} />
}

async function drawPanel($: Engine, e: RenderInput<'AbovePrompt'>): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(e)
  await read($, sync)
  const level = await effortNow($)
  const rows = await $.config.list()
  const modelId = await $.session.model()
  const models = modelChoices(rows.find(row => row.key === 'model'))
  const model = activeModel(models, modelId)
  const width = Math.max(30, Math.min(PANEL_WIDTH, e.props.bodyColumns))
  // border (2) + padding (2)
  const inner = width - 4

  const chip = (key: string, label: string, isActive: boolean, color: string, onPress: () => Promise<void>) =>
    isActive ? (
      <Box key={`${key}-chip`} backgroundColor={color} marginRight={1}>
        <Button key={key} plain label={` ${label} `} onPress={onPress} />
      </Box>
    ) : (
      <Box key={`${key}-chip`} marginRight={1}>
        <Button key={key} plain label={` ${label} `} onPress={onPress} />
      </Box>
    )

  const line = (key: string, name: string, children: RenderElement[]) => (
    <Box key={key} flexDirection="row" flexWrap="wrap">
      <Text dimColor>{name.padEnd(LABEL_WIDTH)}</Text>
      {children}
    </Box>
  )

  // A blank row above and below the title, as between the header and MODEL.
  const section = (key: string, title: string) => (
    <Box key={key} flexDirection="row" marginTop={1} marginBottom={1}>
      <Text dimColor>─ {spaced(title)} ─</Text>
    </Box>
  )

  const settingRows: RenderElement[] = []

  for (const setting of [positionSetting(await positionNow($)), ...settings]) {
    const { value } = setting
    const onPress = () =>
      setting.id === POSITION_SETTING_ID
        ? setPosition($, positionFromLabel(nextValue(setting, value)))
        : pressAddon($, setting.id, nextValue(setting, value))
    const control =
      setting.kind === 'toggle' && value !== true ? (
        <Button key={`set-${setting.id}`} plain dimColor label={` ${controlText(setting, value)} `} onPress={onPress} />
      ) : (
        <Box key={`set-${setting.id}-chip`} backgroundColor={setting.kind === 'toggle' ? GREEN : GRAY}>
          <Button key={`set-${setting.id}`} plain label={` ${controlText(setting, value)} `} onPress={onPress} />
        </Box>
      )

    settingRows.push(
      <Box key={`row-${setting.id}`} flexDirection="row" justifyContent="space-between">
        <Text wrap="truncate">
          {isOn(value) ? <Text color={GREEN}>●</Text> : <Text dimColor>○</Text>} {setting.label}
          {setting.hint === undefined ? '' : <Text dimColor>   {setting.hint}</Text>}
        </Text>
        {control}
      </Box>,
    )
  }

  const launchButtons = launches.map(launch =>
    chip(`launch-${launch.id}`, `${launch.icon ?? '◆'} ${launch.label}`, false, ORANGE, () => pressAddon($, launch.id, null)),
  )

  return (
    <Box key="toolbox-panel" flexDirection="column" borderStyle="round" borderColor={ORANGE} paddingLeft={1} paddingRight={1} width={width}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold color={ORANGE}>
          ◆  {spaced('Toolbox')}
        </Text>
        <Box flexDirection="row">
          <Text key="summary" dimColor>
            {summary(model, modelId, level)}{' '}
          </Text>
          <Button key="close" label="−" role="dismiss" onPress={() => setOpen($, false)} />
        </Box>
      </Box>
      <Text color={SHADOW}>{'─'.repeat(inner)}</Text>
      <Text> </Text>
      {line(
        'models',
        'MODEL',
        models.map(choice =>
          chip(`model-${choice.alias}`, choice.label, choice === model, ORANGE, () => chooseModel($, choice)),
        ),
      )}
      {line(
        'efforts',
        'EFFORT',
        EFFORTS.map(choice => chip(`effort-${choice.level}`, choice.label, choice.level === level, PURPLE, () => chooseEffort($, choice))),
      )}
      {settingRows.length > 0 ? section('settings-title', 'Settings') : null}
      {settingRows}
      {launchButtons.length > 0 ? section('launch-title', 'Launch') : null}
      {launchButtons.length > 0 ? (
        <Box key="launches" flexDirection="row" flexWrap="wrap">
          {launchButtons}
        </Box>
      ) : null}
    </Box>
  )
}

export function registerPanel(on: On): void {
  on('engine.create', async ($, e, next) => {
    const built = await next(e)

    return {
      ...built,
      toolbox: {
        addSetting: (setting: ToolboxSetting) => {
          settings = upsert(settings, setting)
        },
        addLaunch: (launch: ToolboxLaunch) => {
          launches = upsert(launches, launch)
        },
      },
    }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'toolbox', description: 'Open or close the Toolbox panel' })
    const stored = await $.store.get(STORE_KEY)
    await update($, isOpen, () => stored === true)
    const storedPosition = await $.store.get(POSITION_STORE_KEY)
    await update($, position, () => (isPosition(storedPosition) ? storedPosition : DEFAULT_POSITION))
    const storedEffort = await $.store.get(EFFORT_STORE_KEY)

    if ((await read($, effort)) === null && isEffort(storedEffort)) {
      await update($, effort, () => storedEffort)
    }

    const result = await next(e)
    // Mods beneath this one add their rows during next(e); draw them.
    await redraw($)

    return result
  })

  on('command.run', { command: 'toolbox' }, ($, e) => {
    try {
      void (async () => {
        try {
          await setOpen($, !(await openNow($)))
        } catch (error) {
          $.ui.toast(`Toolbox could not toggle: ${String(error)}`)
        }
      })()

      return { text: 'Toolbox panel toggled.' }
    } catch (error) {
      return { text: `Toolbox could not toggle: ${String(error)}` }
    }
  })

  // /model, /effort and other mods' commands change what the panel shows.
  on('command.run', async ($, e, next) => {
    const result = await next(e)

    if (e.command === 'effort') {
      await seeEffort($, parseEffortArg(e.args))
    }

    if (e.command !== 'toolbox') {
      await redraw($)
    }

    return result
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    await redraw($)

    return result
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && typeof e.effort === 'string') {
      await seeEffort($, e.effort)
    }

    return yield* next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if ((await positionNow($)) !== 'PromptHint') {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)
    const beneath = await next(e)

    return (
      // The engine's own line may not sit under a Box with a set width: the
      // row stretches to the line instead, and the left part grows.
      <Box flexDirection="row" flexGrow={1}>
        <Box flexGrow={1} flexShrink={1}>
          {beneath}
        </Box>
        <Box flexShrink={0}>{await drawButton($, e)}</Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const open = await openNow($)
    const hasButton = (await positionNow($)) === 'AbovePrompt'

    if (!open && !hasButton) {
      return next(e)
    }

    const { Box } = $.ui.resolve(e)
    // Mods beneath draw first: an add-on may send its row while it draws.
    const beneath = await next(e)
    const panel = open ? await drawPanel($, e) : null

    // The band cannot paint over the transcript, so the panel and the button
    // take their own rows at the right end, last, next to the prompt.
    // Only those rows have a set width: the engine refuses its own node
    // under a Box with one, and `beneath` may hold that node.
    return (
      <Box flexDirection="column">
        {beneath}
        {panel === null ? null : (
          <Box key="panel-row" flexDirection="row" justifyContent="flex-end" width={e.props.bodyColumns}>
            {panel}
          </Box>
        )}
        {hasButton ? (
          <Box key="button-row" flexDirection="row" justifyContent="flex-end" width={e.props.bodyColumns}>
            {await drawButton($, e)}
          </Box>
        ) : null}
      </Box>
    )
  })
}
