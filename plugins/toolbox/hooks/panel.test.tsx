import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { ConfigRow, On } from 'claude-code'
import type { Plugin } from 'claude-code/testing'

import { activeModel, modelChoices, nextValue } from './panel-logic'

const PLUGIN = 'toolbox'
const SURFACES = ['terminal', 'desktop'] as const

const MODEL_ROW: ConfigRow = {
  key: 'model',
  label: 'Model',
  kind: 'choice',
  value: 'Default (recommended)',
  options: ['default', 'sonnet', 'opus', 'haiku', 'fable', 'best', 'sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan'],
  provider: { plugin: 'engine', tier: 'core' },
  isLocked: false,
}

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 30,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 29 },
  view: {},
}

/** `/toolbox` as the person types it. */
const TOOLBOX = { command: 'toolbox', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

const HINT_PROPS = { isDraft: false, isWorking: false, hint: '? for shortcuts' }

type Calls = { configSets: { key: string; value: unknown }[]; commands: { command: string; args: string }[]; toasts: string[] }

type Start = { store?: Record<string, unknown>; isClear?: boolean }

/**
 * Answers what the engine would answer beneath the plugin. With `isClear`, the
 * session is as after a /clear: empty state, the saved store, and no start event.
 */
async function boot($: Engine, on: On, modelId = 'claude-opus-5-5', start: Start = {}): Promise<Calls> {
  const calls: Calls = { configSets: [], commands: [], toasts: [] }
  mock.store(on, start.store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('config.list', () => ({ value: [MODEL_ROW] }))
  on('session.model', () => ({ value: modelId }))
  on('config.set', ($, e) => {
    calls.configSets.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  on('command.run', ($, e) => {
    calls.commands.push({ command: e.command, args: e.args })

    return { text: '' }
  })
  on('ui.toast', ($, e) => {
    calls.toasts.push(e.text)

    return { value: undefined }
  })
  // The engine's own drawing beneath the plugin: an empty band and hint line.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine" />
  })
  if (start.isClear !== true) {
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  }

  return calls
}

function band<S extends (typeof SURFACES)[number]>(surface: S) {
  return { plugin: PLUGIN, surface, component: 'AbovePrompt' as const, props: BAND_PROPS }
}

function hint<S extends (typeof SURFACES)[number]>(surface: S) {
  return {
    plugin: PLUGIN,
    surface,
    component: 'PromptHint' as const,
    props: HINT_PROPS,
    viewport: { columns: 120, rows: 40 },
  }
}

test('model chips come from the /model options, plain models only', () => {
  const choices = modelChoices(MODEL_ROW)
  expect(choices.map(choice => choice.label)).toEqual(['Haiku 4.5', 'Sonnet 5.5', 'Opus 5.5', 'Fable 5.1'])
  expect(activeModel(choices, 'claude-haiku-4-5-20251001')?.alias).toBe('haiku')
  expect(nextValue({ kind: 'choice', options: ['On', 'Both', 'Off'] }, 'Off')).toBe('On')
})

test('/toolbox opens and closes the panel', async ($, on) => {
  await boot($, on)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ key: 'model-opus' })).toBeUndefined()

  await $.command.run(TOOLBOX)
  expect(await ui.find({ key: 'model-opus' })).toBeDefined()

  await $.command.run(TOOLBOX)
  expect(await ui.find({ key: 'model-opus' })).toBeUndefined()
  await ui.unmount()
})

/** The keys of the band's top-level rows, in order. */
async function bandRows(ui: { find: (query: { type: string }) => Promise<{ children: unknown[] } | undefined> }) {
  const root = await ui.find({ type: 'Box' })

  return (root?.children ?? []).map(child => (child as { props?: { key?: string } }).props?.key)
}

test('by default the button is the last row above the prompt and toggles the panel', async ($, on) => {
  await boot($, on)

  for (const surface of SURFACES) {
    const hintUi = await $.ui.mount(hint(surface))
    expect(await hintUi.find({ key: 'toolbox' })).toBeUndefined()
    const bandUi = await $.ui.mount(band(surface))
    expect((await bandUi.find({ key: 'toolbox' }))?.text).toContain('Toolbox')
    expect((await bandRows(bandUi)).at(-1)).toBe('button-row')

    await bandUi.press({ key: 'toolbox' })
    expect(await bandUi.find({ key: 'model-opus' })).toBeDefined()
    expect((await bandRows(bandUi)).slice(-2)).toEqual(['panel-row', 'button-row'])

    await bandUi.press({ key: 'toolbox' })
    expect(await bandUi.find({ key: 'model-opus' })).toBeUndefined()
    await bandUi.unmount()
    await hintUi.unmount()
  }
})

test('the position setting moves the button under the prompt and back', async ($, on) => {
  await boot($, on)
  await $.command.run(TOOLBOX)
  const bandUi = await $.ui.mount(band('terminal'))
  const hintUi = await $.ui.mount(hint('terminal'))
  expect((await bandUi.find({ key: 'set-toolbox.position' }))?.text).toContain('Above prompt')

  await bandUi.press({ key: 'set-toolbox.position' })
  expect((await bandUi.find({ key: 'set-toolbox.position' }))?.text).toContain('Under prompt')
  expect(await bandUi.find({ key: 'button-row' })).toBeUndefined()
  expect((await bandRows(bandUi)).at(-1)).toBe('panel-row')
  expect((await hintUi.find({ key: 'toolbox' }))?.text).toContain('Toolbox')

  await bandUi.press({ key: 'set-toolbox.position' })
  expect(await bandUi.find({ key: 'button-row' })).toBeDefined()
  expect(await hintUi.find({ key: 'toolbox' })).toBeUndefined()
  await hintUi.unmount()
  await bandUi.unmount()
})

test('after a /clear the button stays where the person put it', async ($, on) => {
  await boot($, on, 'claude-opus-5-5', { store: { position: 'PromptHint' }, isClear: true })
  const hintUi = await $.ui.mount(hint('terminal'))
  const bandUi = await $.ui.mount(band('terminal'))
  expect(await hintUi.find({ key: 'toolbox' })).toBeDefined()
  expect(await bandUi.find({ key: 'toolbox' })).toBeUndefined()
  await bandUi.unmount()
  await hintUi.unmount()
})

test('with the button under the prompt it toggles the panel', async ($, on) => {
  await boot($, on, 'claude-opus-5-5', { store: { position: 'PromptHint' } })

  for (const surface of SURFACES) {
    const hintUi = await $.ui.mount(hint(surface))
    expect((await hintUi.find({ key: 'toolbox' }))?.text).toContain('Toolbox')
    await hintUi.press({ key: 'toolbox' })
    const bandUi = await $.ui.mount(band(surface))
    expect(await bandUi.find({ key: 'model-opus' })).toBeDefined()
    await hintUi.press({ key: 'toolbox' })
    expect(await bandUi.find({ key: 'model-opus' })).toBeUndefined()
    await bandUi.unmount()
    await hintUi.unmount()
  }
})

test('the panel highlights the session model', async ($, on) => {
  await boot($, on, 'claude-haiku-4-5-20251001')
  await $.command.run(TOOLBOX)
  const ui = await $.ui.mount(band('terminal'))
  expect((await ui.find({ key: 'model-haiku-chip' }))?.props.backgroundColor).toBeDefined()
  expect((await ui.find({ key: 'model-opus-chip' }))?.props.backgroundColor).toBeUndefined()
  await ui.unmount()
})

test('a click on Sonnet 5.5 sets the model row to sonnet', async ($, on) => {
  const calls = await boot($, on)
  await $.command.run(TOOLBOX)
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'model-sonnet' })
  expect(calls.configSets).toEqual([{ key: 'model', value: 'sonnet' }])
  expect(calls.toasts).toContain('Model changed to Sonnet 5.5')
  await ui.unmount()
})

test('a click on Low runs /effort low and highlights Low', async ($, on) => {
  const calls = await boot($, on)
  await $.command.run(TOOLBOX)
  const ui = await $.ui.mount(band('terminal'))
  await ui.press({ key: 'effort-low' })
  expect(calls.commands).toContainEqual({ command: 'effort', args: 'low' })
  expect(calls.toasts).toContain('Effort changed to Low')
  expect((await ui.find({ key: 'effort-low-chip' }))?.props.backgroundColor).toBeDefined()
  await ui.unmount()
})

test('after a /clear the panel opens and highlights the saved effort', async ($, on) => {
  await boot($, on, 'claude-opus-5-5', { store: { isOpen: true, effort: 'high' }, isClear: true })
  const ui = await $.ui.mount(band('terminal'))
  expect((await ui.find({ key: 'effort-high-chip' }))?.props.backgroundColor).toBeDefined()
  expect((await ui.find({ key: 'effort-low-chip' }))?.props.backgroundColor).toBeUndefined()
  await ui.unmount()
})

test('SETTINGS holds the button position and an empty LAUNCH is hidden', async ($, on) => {
  await boot($, on)
  await $.command.run(TOOLBOX)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ text: /S E T T I N G S/ })).toBeDefined()
  expect(await ui.find({ text: /Toolbox button/ })).toBeDefined()
  expect(await ui.find({ text: /L A U N C H/ })).toBeUndefined()
  await ui.unmount()
})

/** An add-on as Clean View is one: it sends its row, and applies a press of it. */
const ADDON: Plugin = {
  name: 'addon',
  register(on) {
    const row = (value: string) => ({
      id: 'addon.mode',
      label: 'Add-on Mode',
      hint: 'a test row',
      kind: 'choice' as const,
      options: ['On', 'Both', 'Off'],
      value,
    })

    on('session.start', async ($, e, next) => {
      $.toolbox.addSetting(row('On'))

      return next(e)
    })

    on('state.set', { plugin: 'toolbox', key: 'press' }, async ($, e, next) => {
      const result = await next(e)
      const pressed = e.value

      if (pressed !== null && pressed.id === 'addon.mode') {
        $.toolbox.addSetting(row(String(pressed.value)))
      }

      return result
    })
  },
}

test('an add-on setting shows under SETTINGS and a click reaches the add-on', { plugins: [ADDON] }, async ($, on) => {
  await boot($, on)
  await $.command.run(TOOLBOX)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ text: /S E T T I N G S/ })).toBeDefined()
  expect(await ui.find({ text: /Add-on Mode/ })).toBeDefined()
  expect((await ui.find({ key: 'set-addon.mode' }))?.text).toContain('On')
  await ui.press({ key: 'set-addon.mode' })
  expect((await ui.find({ key: 'set-addon.mode' }))?.text).toContain('Both')
  await ui.unmount()
})
