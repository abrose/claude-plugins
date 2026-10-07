export type PromptStyle = 'box' | 'banner' | 'gutter' | 'label' | 'double'

declare module 'claude-code' {
  interface PluginState {
    'chebu-ui': { promptStyle: PromptStyle }
  }
}
