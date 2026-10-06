import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock, Plugin } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

const PLUGIN = 'clean-view'
const PLAN = 'mcp__clean-view__plan_steps'
const PROGRESS = 'mcp__clean-view__report_progress'
const SURFACES = ['terminal', 'desktop'] as const

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: true,
  maxRows: 20,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

type Start = { store?: Record<string, unknown>; isClear?: boolean }

/**
 * Answers what the engine would answer beneath the plugin. Register test hooks before calling it.
 * With `isClear`, the session is as after a /clear: empty state, the saved store, and no start event.
 */
async function boot($: Engine, on: On, start: Start = {}): Promise<MockClock> {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, start.store)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__clean-view__${e.name}` } }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Notification', () => ({}))
  // The engine's own band beneath the plugin: empty.
  on('ui.render', ($, e) => h($.ui.resolve(e).Box, { key: 'engine' }) as RenderElement)
  on('model.complete', () => ({
    value: {
      isAnswered: true as const,
      text: 'Build my landing page',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  if (start.isClear !== true) {
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  }

  return clock
}

function band<S extends (typeof SURFACES)[number]>(surface: S) {
  return { plugin: PLUGIN, surface, component: 'AbovePrompt' as const, props: BAND_PROPS }
}

test('names are cleaned to plain English', async ($, on) => {
  await boot($, on)
  const long = 'Make the onboarding flow feel welcoming and friendly for every brand new visitor today'
  expect(long.length).toBeGreaterThan(80)
  await $.tool.call({
    tool: PLAN,
    steps: ['Build the pricing section in `src/Pricing.tsx`', 'update the header in src/components/Header now', long],
  })

  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: /^Build the pricing section in\s*$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Update the header in now\s*$/ })).toBeDefined()
  expect(await ui.find({ text: /src|Pricing\.tsx|`/ })).toBeUndefined()
  const trimmed = await ui.find({ type: 'Text', text: /^Make the onboarding.*…\s*$/ })
  expect(trimmed).toBeDefined()
  expect((trimmed?.text ?? '').trim().length).toBeLessThanOrEqual(40)
  await ui.unmount()
})

test('a to-do list plus a 60% report draws done, active, next and up next rows', async ($, on) => {
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] }, text: 'ok' }))
  await boot($, on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Read your brand notes', status: 'completed', activeForm: 'Reading your brand notes' },
      { content: 'Build the pricing section', status: 'in_progress', activeForm: 'Building the pricing section' },
      { content: 'Add the contact form', status: 'pending', activeForm: 'Adding the contact form' },
      { content: 'Polish the footer', status: 'pending', activeForm: 'Polishing the footer' },
    ],
  } as never)
  await $.tool.call({ tool: PROGRESS, task: 'Build the pricing section', percent: 60 })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    const done = await ui.find({ key: 'row-todo-1' })
    const active = await ui.find({ key: 'row-todo-2' })
    const next = await ui.find({ key: 'row-todo-3' })
    const later = await ui.find({ key: 'row-todo-4' })
    expect(done?.text).toMatch(/✓.*Read your brand notes.*■{16}.*Done/)
    expect(active?.text).toMatch(/●.*Build the pricing section.*■{16}.*60%/)
    expect(next?.text).toMatch(/Add the contact form.*■{16}.*Next/)
    // One step done and the active one 60% along: 1.6 of 4 steps.
    expect((await ui.find({ key: 'overall' }))?.text).toMatch(/^Step 2 of 4 .*40%$/)
    expect(next?.text).not.toMatch(/Up next/)
    expect(later?.text).toMatch(/Polish the footer.*Up next/)
    expect(await ui.find({ key: 'toggle' })).toBeDefined()
    await ui.unmount()
  }
})

test('a permission prompt shows Needs you', async ($, on) => {
  await boot($, on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ text: /Needs you/ })).toBeDefined()
    expect(await ui.find({ text: /needs your OK to continue/ })).toBeDefined()
    expect(await ui.find({ text: /‖/ })).toBeDefined()
    await ui.unmount()
  }
})

test('/simple off hides the band and keeps the button', async ($, on) => {
  await boot($, on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  const ran = await $.command.run({ command: 'simple', args: 'off' } as never)
  expect(ran.text).toBe('Clean View is off.')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ text: /Understand your request/ })).toBeUndefined()
    const button = await ui.find({ key: 'toggle' })
    expect(button?.props.label).toBe('○ Clean View: OFF')
    await ui.unmount()
  }
})

test('plan_steps then report_progress at 100 checks off step one and starts step two', async ($, on) => {
  await boot($, on)
  const planned = await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section', 'Polish the footer'] })
  expect(planned.result).toBe('Planned 3 steps. The first one has started.')

  const noted = await $.tool.call({ tool: PROGRESS, task: 'Read your brand notes', percent: 140 })
  expect(noted.result).toBe('Progress noted: 100%.')

  const ui = await $.ui.mount(band('terminal'))
  expect((await ui.find({ key: 'row-step-1' }))?.text).toMatch(/✓.*Done/)
  expect((await ui.find({ key: 'row-step-2' }))?.text).toMatch(/●.*Build the pricing section.*Working/)
  expect((await ui.find({ key: 'row-step-3' }))?.text).toMatch(/Next/)
  await ui.unmount()
})

test('tools are denied before a plan exists and allowed after', async ($, on) => {
  let ranBash = 0
  on('tool.call', { tool: 'Bash' }, () => {
    ranBash += 1

    return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }
  })
  await boot($, on)

  const before = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(before.deny ?? before.text ?? '').toContain('plan_steps')
  expect(ranBash).toBe(0)

  await $.tool.call({ tool: PLAN, steps: ['Look around the project', 'Answer your question'] })
  const after = await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(after.deny).toBeUndefined()
  expect(ranBash).toBe(1)
})

test('tool rows are hidden while Clean View is on and come back when off', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: ['Bash(ls)'] })
  })
  await boot($, on)
  const row = {
    plugin: PLUGIN,
    component: 'ToolUse' as const,
    props: { tool_use_id: 'tu1', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
  }

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...row, surface })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { display: 'none' } })
    await ui.unmount()
  }

  await $.command.run({ command: 'simple', args: 'off' } as never)
  const ui = await $.ui.mount({ ...row, surface: 'terminal' })
  expect(await ui.find({ text: /Bash\(ls\)/ })).toBeDefined()
  await ui.unmount()
})

test('/simple both shows tool rows and the checklist together', async ($, on) => {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)

    return Text({ children: ['Bash(ls)'] })
  })
  await boot($, on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  const ran = await $.command.run({ command: 'simple', args: 'both' } as never)
  expect(ran.text).toBe('Clean View is on, with every detail shown.')

  for (const surface of SURFACES) {
    const row = await $.ui.mount({
      plugin: PLUGIN,
      surface,
      component: 'ToolUse' as const,
      props: { tool_use_id: 'tu1', tool: 'Bash', input: { command: 'ls' }, isRunning: false, isErrored: false, isInterrupted: false },
    })
    expect(await row.find({ text: /Bash\(ls\)/ })).toBeDefined()
    await row.unmount()

    const ui = await $.ui.mount(band(surface))
    expect(await ui.find({ text: /Understand your request/ })).toBeDefined()
    expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('◐ Clean View: BOTH')
    await ui.unmount()
  }
})

test('/simple with no argument cycles on, both, off', async ($, on) => {
  await boot($, on)
  const replies: string[] = []

  for (let at = 0; at < 3; at += 1) {
    replies.push((await $.command.run({ command: 'simple', args: '' } as never)).text ?? '')
  }

  expect(replies).toEqual(['Clean View is on, with every detail shown.', 'Clean View is off.', 'Clean View is on.'])
  expect((await $.command.run({ command: 'simple', args: 'maybe' } as never)).text).toMatch(/\/simple both/)
})

test('the plan gate stays on in both mode and is off in off mode', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }))
  await boot($, on)

  await $.command.run({ command: 'simple', args: 'both' } as never)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).deny).toContain('plan_steps')

  await $.command.run({ command: 'simple', args: 'off' } as never)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' } as never)).deny).toBeUndefined()
})

test('off mode tells the model to skip the Clean View tools', async ($, on) => {
  on('tool.describe', ($, e) => ({ description: e.description }))
  await boot($, on)
  const describe = () =>
    $.tool.describe({ tool: PLAN, description: 'Call it first for every request.', provider: { plugin: PLUGIN } } as never)

  expect((await describe()).description).toBe('Call it first for every request.')

  await $.command.run({ command: 'simple', args: 'off' } as never)
  expect(await describe()).toEqual({ description: expect.stringMatching(/Clean View is off/), isDeferred: true })
  expect((await $.tool.call({ tool: PLAN, steps: ['Read the code', 'Fix the bug'] } as never)).result).toMatch(/Clean View is off/)
  expect((await $.tool.call({ tool: PROGRESS, task: 'Read the code', percent: 100 } as never)).result).toMatch(/Clean View is off/)

  await $.command.run({ command: 'simple', args: 'on' } as never)
  expect((await describe()).description).toBe('Call it first for every request.')
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ text: /Read the code/ })).toBeUndefined()
  await ui.unmount()
})

/** Stands in for the Toolbox mod: keeps the rows sent to it and presses one from the hint line. */
const FAKE_TOOLBOX: Plugin = {
  name: 'toolbox',
  register(on) {
    let rows: { id: string; value: boolean | string; options?: readonly string[] }[] = []

    on('engine.create', async ($, e, next) => ({
      ...(await next(e)),
      toolbox: {
        addSetting: (row: { id: string; value: boolean | string; options?: readonly string[] }) => {
          rows = [...rows.filter(one => one.id !== row.id), row]
        },
      },
    }))

    on('ui.render', { component: 'PromptHint' }, async ($, e) => {
      const { Box, Button, Text } = $.ui.resolve(e)
      const row = rows.find(one => one.id === 'clean-view.mode')
      const options = row?.options ?? []
      const value = options[(options.indexOf(String(row?.value)) + 1) % options.length] ?? null

      return h(
        Box,
        {},
        h(Text, {}, `Clean View: ${String(row?.value)}`),
        h(Button, {
          key: 'press',
          label: 'next',
          onPress: () => $.state.set({ plugin: 'toolbox', key: 'press' }, { id: 'clean-view.mode', value, count: Date.now() }),
        }),
      ) as RenderElement
    })
  },
}

test('with Toolbox loaded, the Clean View row matches /simple and a press steps it', { plugins: [FAKE_TOOLBOX] }, async ($, on) => {
  await boot($, on)
  const hint = { plugin: 'toolbox', surface: 'terminal' as const, component: 'PromptHint' as const, props: { isDraft: false, isWorking: false, hint: '' } }
  // The stand-in keeps rows in a plain variable, so each check draws it afresh.
  const rowText = async () => {
    const ui = await $.ui.mount(hint)
    const text = (await ui.find({ type: 'Text', text: /^Clean View: / }))?.text
    await ui.unmount()

    return text
  }
  expect(await rowText()).toBe('Clean View: On')

  await $.command.run({ command: 'simple', args: 'off' } as never)
  expect(await rowText()).toBe('Clean View: Off')

  const ui = await $.ui.mount(hint)
  await ui.press({ key: 'press' })
  await ui.unmount()
  expect(await rowText()).toBe('Clean View: On')
  // The mode switch lives in the Toolbox panel, so the band has no button of its own.
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ key: 'toggle' })).toBeUndefined()
  await band.unmount()
})

test('after a /clear the Toolbox row shows the saved mode', { plugins: [FAKE_TOOLBOX] }, async ($, on) => {
  await boot($, on, { store: { cleanViewMode: 'both' }, isClear: true })
  // Clean View sends its row while it draws its band.
  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  await band.unmount()
  const ui = await $.ui.mount({ plugin: 'toolbox', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '' } })
  expect((await ui.find({ type: 'Text', text: /^Clean View: / }))?.text).toBe('Clean View: Both')
  await ui.unmount()
})


test('the mode buttons in the band header switch the mode', async ($, on) => {
  await boot($, on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })

  const ui = await $.ui.mount(band('terminal'))
  expect((await ui.find({ key: 'mode-on' }))?.props.label).toBe('[On]')
  expect((await ui.find({ key: 'mode-both' }))?.props.label).toBe(' Both ')
  expect((await ui.find({ key: 'mode-off' }))?.props.label).toBe(' Off ')

  await ui.press({ key: 'mode-both' })
  expect((await ui.find({ key: 'mode-both' }))?.props.label).toBe('[Both]')
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('◐ Clean View: BOTH')

  await ui.press({ key: 'mode-off' })
  expect(await ui.find({ key: 'mode-off' })).toBeUndefined()
  expect((await ui.find({ key: 'toggle' }))?.props.label).toBe('○ Clean View: OFF')
  await ui.unmount()
})

test('a finished list stays visible until Clear is pressed', async ($, on) => {
  const clock = await boot($, on)
  await $.turn.start({ text: 'Build my landing page', turnId: 't1' })
  await $.tool.call({ tool: PLAN, steps: ['Read your brand notes', 'Build the pricing section'] })
  await $.tool.call({ tool: PROGRESS, task: 'Read your brand notes', percent: 100 })
  await $.tool.call({ tool: PROGRESS, task: 'Build the pricing section', percent: 100 })

  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ key: 'clear' })).toBeUndefined()

  await $.turn.complete({ answer: 'Done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(60_000)
  expect(await ui.find({ text: /All done/ })).toBeDefined()
  expect((await ui.find({ key: 'row-step-2' }))?.text).toMatch(/✓.*Build the pricing section.*Done/)

  await ui.press({ key: 'clear' })
  expect(await ui.find({ key: 'frame' })).toBeUndefined()
  expect(await ui.find({ key: 'toggle' })).toBeDefined()
  await ui.unmount()
})
