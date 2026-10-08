import { envoyOnly } from './decide'
import type { Io, ToolResult } from './io'

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
  const sent = await io.sendTo(cfg.orchestrator_session, `RELAY ${message.replace(/\n/g, '\n  ')}`)
  if (!sent.isDelivered) return fail(`not delivered: ${sent.reason ?? 'unknown reason'}`)
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
