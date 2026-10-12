import { describe, expect, test } from 'claude-code/testing'
import { pluginVersion } from '../../hooks/mod/version'

describe('pluginVersion', () => {
  test('reads the version field of plugin.json text', () => {
    expect(pluginVersion('{"name":"team","version":"0.8.0"}')).toBe('0.8.0')
  })

  test('bad JSON gives null', () => {
    expect(pluginVersion('{"name": ')).toBeNull()
  })

  test('no version field gives null', () => {
    expect(pluginVersion('{"name":"team"}')).toBeNull()
  })

  test('a version that is not a text gives null', () => {
    expect(pluginVersion('{"version":8}')).toBeNull()
  })

  test('missing text gives null', () => {
    expect(pluginVersion(null)).toBeNull()
  })
})
