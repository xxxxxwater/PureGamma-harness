/** Cordis-mounted, session-scoped PureGamma Trust v2. */
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { TrustLedger, policyOf } from './ledger.mjs'
import { configureAttestations, AttestationVault } from './attestations.mjs'
import { SignedGate } from './signed-gate.mjs'

export const name = 'evidence-trust'
export const inject = ['tools', 'loader']

export async function apply(ctx, config = {}) {
  const policy = policyOf(config)
  const cfg = configureAttestations(config.attestations, policy.mode)
  const root = config.root ?? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'pg-trust-ledgers')
  if (!isAbsolute(root)) throw new TypeError('trust root must be absolute')
  const vault = new AttestationVault(root, cfg)
  const gate = new SignedGate(policy, cfg, vault)
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
  // Audit ALL final tool results including policy denials. Never persist their
  // actual arguments or outputs. I/O failure makes the ledger unhealthy.
  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent || exec.name.startsWith('pg_trust_')) return
    try { ledgerFor(exec.agent).observe(exec, result) }
    catch { /* On enforcement the next protected operation fails closed. */ }
  })
  // The guard runs after pre-execute policy: an ordinary listener cannot allow
  // a denied operation. Trade reservation is atomic and is never refunded.
  ctx.tools.guard(exec => {
    if (policy.mode !== 'enforce' || !gate.protects(exec.name)) return undefined
    if (!exec.agent) return 'PG_TRUST_GATE: missing-agent-session'
    try {
      const decision = gate.decide(exec, ledgerFor(exec.agent), true)
      return decision.allowed ? undefined : 'PG_TRUST_GATE: ' + decision.reason
    } catch {
      return 'PG_TRUST_GATE: ledger-or-proof-unavailable'
    }
  })

  const { defineTool } = await ctx.root.loader.import('@deepseek-ai/dsh-tools', () => [])
  const output = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
  ctx.tools.register(defineTool({
    name: 'pg_trust_status',
    description: 'View this session ledger, unknowns and linked evidence, and the number of currently valid signed proofs; never treats ordinary tool success as signed authorization.',
    parameters: {}, output,
    execute: async (_args, exec) => {
      const ledger = ledgerFor(exec.agent)
      return { ...ledger.status(policy),
        verification_generation: 2, signed_proofs: vault.list().length,
        signed_release_patterns: config.attestations?.release?.tools ?? [],
        signed_trade_patterns: config.attestations?.trade?.tools ?? [] }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'pg_trust_open_unknown',
    description: 'Record an unresolved question grounded in an existing local Evidence ID. Do not include secrets or identifying content.',
    parameters: {
      source_evidence_id: { type: 'string', required: true },
      question: { type: 'string', required: true },
    }, output,
    execute: async (args, exec) => {
      const id = ledgerFor(exec.agent).openUnknown(args.source_evidence_id, args.question)
      return { unknown_id: id, state: 'open' }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'pg_trust_resolve_unknown',
    description: 'Resolve a question using signed attestation evidence in enforce mode. Audit mode retains the legacy later-successful-verifier observation path.',
    parameters: {
      unknown_id: { type: 'string', required: true },
      attestation_id: { type: 'string' },
      verification_evidence_id: { type: 'string' },
    }, output,
    execute: async (args, exec) => {
      const ledger = ledgerFor(exec.agent)
      if (policy.mode === 'enforce') {
        if (!args.attestation_id) throw new Error('signed attestation_id required for enforce mode')
        ledger.resolveUnknownSigned(args.unknown_id, vault.read(args.attestation_id))
      } else {
        if (!args.verification_evidence_id) throw new Error('verification_evidence_id required in audit mode')
        ledger.resolveUnknown(args.unknown_id, args.verification_evidence_id, policy)
      }
      return { unknown_id: args.unknown_id, state: 'resolved',
        authority: policy.mode === 'enforce' ? 'ed25519-signed' : 'legacy-observation' }
    },
  }))
  ctx.tools.register(defineTool({
    name: 'pg_trust_import_attestation',
    description: 'Verify and persist an Ed25519-signed CI or independent trading-risk attestation. Signature, expiry and pinned signer are checked; importing alone never authorizes a mismatched target.',
    parameters: { envelope: { type: 'json', required: true } }, output,
    execute: async (args, _exec) => vault.import(args.envelope),
  }))
  ctx.tools.register(defineTool({
    name: 'pg_trust_link_evidence',
    description: 'Anchor an existing observation in another session by its digest and source ledger head. A cross-session link is never a signed release/trading permission.',
    parameters: {
      source_session_id: { type: 'string', required: true },
      source_evidence_id: { type: 'string', required: true },
    }, output,
    execute: async (args, exec) => ({
      link_id: ledgerFor(exec.agent).linkEvidence(args.source_session_id, args.source_evidence_id),
      authority: 'cross-session-historical-reference',
    }),
  }))
  ctx.tools.register(defineTool({
    name: 'pg_trust_check_gate',
    description: 'Read-only preflight of a fully bound tool invocation. Never reserves a trading intent and never grants permission.',
    parameters: {
      target_tool: { type: 'string', required: true },
      target_arguments: { type: 'json', required: true },
    }, output,
    execute: async (args, exec) => {
      const verdict = gate.decide({ name: args.target_tool, arguments: args.target_arguments }, ledgerFor(exec.agent), false)
      return { ...verdict, mode: policy.mode, enforced: policy.mode === 'enforce',
        effective_allow: policy.mode === 'enforce' ? verdict.allowed : true }
    },
  }))
}
