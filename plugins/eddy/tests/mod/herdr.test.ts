import { describe, expect, test } from 'claude-code/testing'
import { herdrDialog } from '../../hooks/mod/herdr'
import type { Io } from '../../hooks/mod/io'
import { BASH_DIALOG_SNAPSHOT, BASH_DIALOG_TEXT, DIALOG_SNAPSHOT, DIALOG_TEXT } from './world'

/** An Io whose only live call is `herdr agent read`: it answers with the given stdout and exit code. */
const ioReading = (stdout: string, exitCode = 0): Io =>
  ({
    envGet: async () => undefined,
    run: async () => ({ exitCode, stdout, stderr: exitCode === 0 ? '' : 'pane gone' }),
  }) as unknown as Io

const dialog = (stdout: string, exitCode = 0) => herdrDialog(ioReading(stdout, exitCode), 'w1:p2')
const RULE = '─'.repeat(126)
const DASHED = '╌'.repeat(126)

describe('herdrDialog', () => {
  test('a Bash permission dialog gives title, command and question', async () => {
    expect(await dialog(BASH_DIALOG_SNAPSHOT)).toBe(BASH_DIALOG_TEXT)
    expect(BASH_DIALOG_TEXT).toBe('Bash command / python3 -c "print(1)" / Do you want to proceed?')
  })

  test('without a full-width rule it falls back to the last 3 non-empty rows', async () => {
    expect(await dialog(DIALOG_SNAPSHOT)).toBe(DIALOG_TEXT)
    expect(await dialog('a\n\nb\n  c  \n\nd\n')).toBe('b / c / d')
  })

  test('a short rule is not a frame', async () => {
    expect(await dialog(['old', '─'.repeat(19), 'x', 'y', 'z', 'w'].join('\n'))).toBe('y / z / w')
  })

  test('the last frame wins when several rules show', async () => {
    const snap = [RULE, 'Old title', DASHED, 'old cmd', DASHED, 'Old?', RULE, 'Edit file', 'Allow edit?'].join('\n')
    expect(await dialog(snap)).toBe('Edit file / Allow edit?')
  })

  test('a frame without a dashed pair returns the rows below it, minus the Esc row', async () => {
    const snap = ['history', RULE, ' Edit file', ' src/a.ts', '', ' Esc to cancel · Tab to amend'].join('\n')
    expect(await dialog(snap)).toBe('Edit file / src/a.ts')
  })

  test('a frame with a dashed pair but no question row uses the rows below the frame', async () => {
    const snap = [RULE, ' Title', DASHED, ' the command', DASHED, ' Esc to cancel'].join('\n')
    expect(await dialog(snap)).toBe('Title / the command')
  })

  test('a frame with a question row but no dashed pair uses the rows below the frame', async () => {
    const snap = [RULE, ' Title', ' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', ' Esc to cancel'].join('\n')
    expect(await dialog(snap)).toBe('Title / Do you want to proceed? / ❯ 1. Yes / 2. No')
  })

  test('a result over 200 characters is cut to 200', async () => {
    const long = 'x'.repeat(300)
    expect((await dialog(`${RULE}\n${long}`)).length).toBe(200)
    expect((await dialog(`${long}\nb\nc`)).length).toBe(200)
    expect((await dialog(`${RULE}\nT\n${DASHED}\n${long}\n${DASHED}\nQ?`)).length).toBe(200)
  })

  test('fewer than 3 rows come back as they are', async () => {
    expect(await dialog('only row')).toBe('only row')
    expect(await dialog('one\n\ntwo')).toBe('one / two')
  })

  test('an empty snapshot gives an empty string', async () => {
    expect(await dialog('')).toBe('')
    expect(await dialog('\n  \n\n')).toBe('')
  })

  test('a failed read gives an empty string', async () => {
    expect(await dialog(BASH_DIALOG_SNAPSHOT, 1)).toBe('')
  })
})
