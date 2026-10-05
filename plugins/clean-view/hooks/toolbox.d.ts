// The part of the Toolbox mod that Clean View uses. Clean View does not list
// Toolbox as a dependency: `$.toolbox` is there only while Toolbox is loaded,
// so each call to it is wrapped in try/catch, and the `toolbox.press` hook
// below simply never fires without it.

export type ToolboxSetting = {
  id: string
  label: string
  hint?: string
  kind: 'toggle' | 'choice'
  options?: readonly string[]
  value: boolean | string
}

export type ToolboxPress = {
  id: string
  value: boolean | string | null
  count: number
}

declare module 'claude-code' {
  interface EngineInterface {
    toolbox: { addSetting: (setting: ToolboxSetting) => void }
  }

  interface PluginState {
    toolbox: { press: ToolboxPress | null }
  }
}
