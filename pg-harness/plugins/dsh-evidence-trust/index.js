/** Cordis integration for PureGamma evidence, unknowns, and verification gate. */
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { TrustLedger, policyOf } from './ledger.mjs'

export const name = 'evidence-trust'
export const inject = ['tools', 'loader']

export async function apply(ctx, config = {}) {
  const policy = policyOf(config)
  const root = config.root ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'pg-trust-ledgers')
  if (!isAbsolute(root)) throw new TypeError('trust root must be an absolute path')
  const sessions = new Map()
  const ledgerFor = agent => {
    const id = agent?.session?.id
    if (typeof id !== 'string' || !id) throw new Error('PureGamma Trust requires an Agent session')
    let ledger = sessions.get(id)
    if (!ledger) {
      ledger = new TrustLedger(root, id)
      sessions.set(id, ledger)
    }
    return ledger
  }

  // This observer sees the FINAL immutable tool result, including denied calls.
  // A ledger I/O error is recorded as unhealthy; enforcement subsequently denies.
  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent || exec.name.startsWith('pg_trust_')) return
    try { ledgerFor(exec.agent).observe(exec, result) }
    catch { /* ledger marks itself broken; a failed constructor is retried */ }
  })

  // Monotonic, executor-owned denial AFTER all tools/pre-execute waterfalls:
  // an allow-listener cannot override this check. Protected direct calls have
  // no session identity and must fail closed.
  ctx.tools.guard(exec => {
    if (policy.mode !== 'enforce' || !policy.protected.some(p => p.test(exec.name))) return undefined
    if (!exec.agent) return 'PG_TRUST_GATE: protected tool requires an Agent session'
    try {
      const decision = ledgerFor(exec.agent).evaluate(exec.name, policy)
      return decision.allowed ? undefined : 'PG_TRUST_GATE: ' + decision.reason
    } catch {
      return 'PG_TRUST_GATE: ledger-unavailable'
    }
  })

  const { defineTool } = await ctx.root.loader.import('@deepseek-ai/dsh-tools', () => [])
  const output = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
  ctx.tools.register(defineTool({
    name: 'pg_trust_status',
    description: 'Inspect the current session evidence ledger, unresolved questions and verification policy. Evidence contains digests, not raw tool results.',
    parameters: {},
    output,
    execute: async (_args, exec) => ledgerFor(exec.agent).status(policy),
  }))
  ctx.tools.register(defineTool({
    name: 'pg_trust_open_unknown',
    description: 'Record an unresolved question backed by an exact evidence id from pg_trust_status. Do not include tokens or private data in the question.',
    parameters: {
      source_evidence_id: { type: 'string', required: true },
      question: { type: 'string', required: true },
    },
    output,
    execute: async (args, exec) => {
      const id = ledgerFor(exec.agent).openUnknown(args.source_evidence_id, args.question)
      return { unknown_id: id, state: 'open' }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'pg_trust_resolve_unknown',
    description: 'Resolve an unknown only with a later successful observation from a configured verifier tool. This does not assert broad semantic correctness.',
    parameters: {
      unknown_id: { type: 'string', required: true },
      verification_evidence_id: { type: 'string', required: true },
    },
    output,
    execute: async (args, exec) => {
      ledgerFor(exec.agent).resolveUnknown(args.unknown_id, args.verification_evidence_id, policy)
      return { unknown_id: args.unknown_id, state: 'resolved' }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'pg_trust_check_gate',
    description: 'Read-only preflight of the configured verification gate for one tool name. Cannot grant execution or manufacture verification.',
    parameters: { target_tool: { type: 'string', required: true } },
    output,
    execute: async (args, exec) => ledgerFor(exec.agent).evaluate(args.target_tool, policy),
  }))
}
