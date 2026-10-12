/** The `version` field of plugin.json text. Missing text, bad JSON or no text field give null. */
export function pluginVersion(text: string | null): string | null {
  if (text === null) return null
  try {
    const version = (JSON.parse(text) as { version?: unknown } | null)?.version
    return typeof version === 'string' && version !== '' ? version : null
  } catch {
    return null
  }
}
