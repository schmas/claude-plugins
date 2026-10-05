/** A reasoning effort level, as `/effort` takes it. */
export type ToolboxEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Where the Toolbox button sits: the band above the prompt, or the hint line under it. */
export type ToolboxPosition = 'AbovePrompt' | 'PromptHint'

export type ToolboxSettingValue = boolean | string

/**
 * A row another mod adds under SETTINGS. Plain data: a mod sends it again
 * with the new `value` each time the value changes.
 */
export type ToolboxSetting = {
  /** Unique across mods, led by the mod's name, like `clean-view.mode`. */
  id: string
  label: string
  /** Short dim text after the label. */
  hint?: string
  /** `toggle` flips a boolean; `choice` steps through `options`. */
  kind: 'toggle' | 'choice'
  /** The values a `choice` row steps through, in order. */
  options?: readonly string[]
  /** The current value. */
  value: ToolboxSettingValue
}

/** A button another mod adds under LAUNCH. Plain data. */
export type ToolboxLaunch = {
  /** Unique across mods, led by the mod's name. */
  id: string
  label: string
  /** One glyph before the label, like `✦`. */
  icon?: string
}

/**
 * What Toolbox writes to its `press` state when the person clicks an add-on
 * row or button. The add-on hooks `state.set` on
 * `{ plugin: 'toolbox', key: 'press' }` and acts on its own `id`.
 */
export type ToolboxPress = {
  id: string
  /** The value a setting row moves to; null for a LAUNCH button. */
  value: ToolboxSettingValue | null
  /** Counts presses, so two presses of one row are two writes. */
  count: number
}

/**
 * What Toolbox adds to `$`. Arguments cross between mods as plain data, so
 * they hold no functions. A second add with the same id replaces the first.
 */
export type Toolbox = {
  addSetting: (setting: ToolboxSetting) => void
  addLaunch: (launch: ToolboxLaunch) => void
}

declare module 'claude-code' {
  interface EngineInterface {
    toolbox: Toolbox
  }

  interface PluginState {
    toolbox: {
      /** True while the panel shows above the prompt. */
      isOpen: boolean
      /** The main loop's effort as last seen; null until known. */
      effort: ToolboxEffort | null
      /** Where the button sits; the person picks it under SETTINGS. */
      position: ToolboxPosition
      /** Bumped to redraw after a change Toolbox cannot subscribe to. */
      sync: number
      /** The last add-on row or button pressed. */
      press: ToolboxPress | null
    }
  }
}
