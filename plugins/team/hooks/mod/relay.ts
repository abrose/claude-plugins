import { envoyOnly } from './decide'
import type { Io, ToolResult } from './io'
import { teamDir } from './paths'

const fail = (result: string): ToolResult => ({ result, isError: true })

export async function relayTool(io: Io, input: unknown): Promise<ToolResult> {
  const cfg = await envoyOnly(io, 'relay')
  if ('result' in cfg) return cfg
  if (!cfg.envoy_session) return fail('relay needs a separate envoy session; this session runs the orchestrator')
  if (!cfg.orchestrator_session) return fail('relay needs a running orchestrator: the config has no orchestrator_session')
  const raw = (input as { message?: unknown } | null)?.message
  const message = typeof raw === 'string' ? raw.trim().replace(/\r\n?|[\u{2028}\u{2029}]/gu, '\n') : ''
  if (message === '') return fail('message is required')
  // Lines after the first are indented: no relayed line starts with REPORT, DECISION or WATCH.
  const text = `RELAY ${message.replace(/\n/g, '\n  ')}`
  // Claude Code drops a peer message identical to the previous one yet still reports it as sent,
  // so the relay refuses it. "Last" is the last text sent to the orchestrator, kept in a file of the
  // run: it survives an envoy /clear and a mod reload, and a message not delivered never counts.
  // The file holds the orchestrator session on its first line, then the text: a text sent to
  // another orchestrator session (or a file without a session line) is not the previous message.
  const lastPath = `${await teamDir(io)}/last-relay.txt`
  const stored = `${cfg.orchestrator_session}\n${text}`
  if (stored === (await io.readText(lastPath))) return fail('relay refused: same text as the last relay')
  const sent = await io.sendTo(cfg.orchestrator_session, text)
  if (!sent.isDelivered) return fail(`not delivered: ${sent.reason ?? 'unknown reason'}`)
  await io.writeText(lastPath, stored)
  return { result: 'sent' }
}

export const RELAY_TOOL_SPEC = {
  name: 'relay',
  description:
    'Pass an operational request from the human to the orchestrator. Envoy session only. Returns "sent".',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string', description: 'The request, as the human gave it.' } },
    required: ['message'],
  },
}
