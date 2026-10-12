import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from './index.js'

function harness() {
  const events = new Map(), tools = new Map()
  let gate
  const ctx = {
    on(name, listener) { events.set(name, listener) },
    tools: {
      guard(handler) { gate = handler },
      register(definition) { tools.set(definition.name, definition) },
    },
    root: { loader: { import: async () => ({ defineTool: spec => spec }) } },
  }
  return { ctx, events, tools, gate: () => gate }
}
const sample = (agent, name, failed = false) => ({
  exec: { agent, name, callId: name + ':1', arguments: { path: 'x' } },
  result: { isError: failed, content: [{ type: 'text', text: 'opaque' }] },
})

test('audit defaults to observing without blocking any other tools', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pg-plugin-'))
  try {
    const h = harness()
    await apply(h.ctx, { root })
    const agent = { session: { id: 'session-a' } }
    h.events.get('tools/result')(...Object.values(sample(agent, 'test')) )
    assert.equal(h.gate()({ name: 'publish_release', agent }), undefined)
    const status = await h.tools.get('pg_trust_status').execute({}, { agent })
    assert.equal(status.observations, 1)
    assert.equal(status.integrity, 'ok')
    assert.equal(h.tools.size, 4)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('execution guard rejects until verifier proof and unresolved unknowns are cleared', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pg-plugin-'))
  try {
    const h = harness()
    await apply(h.ctx, { root, mode: 'enforce',
      protectedTools: ['publish_*'], verifierTools: ['ci_check'], mutationTools: ['code_edit'] })
    const agent = { session: { id: 'session-b' } }
    const gate = h.gate()
    assert.match(gate({ name: 'publish_release', agent }), /missing-or-stale/)
    assert.match(gate({ name: 'publish_release' }), /requires an Agent/)
    h.events.get('tools/result')(...Object.values(sample(agent, 'code_edit')))
    let status = await h.tools.get('pg_trust_status').execute({}, { agent })
    const source = status.evidence.at(-1).id
    const unknown = await h.tools.get('pg_trust_open_unknown').execute({ source_evidence_id: source, question: 'Did the migration finish?' }, { agent })
    h.events.get('tools/result')(...Object.values(sample(agent, 'ci_check')))
    assert.match(gate({ name: 'publish_release', agent }), /open-unknowns/)
    status = await h.tools.get('pg_trust_status').execute({}, { agent })
    const proof = status.evidence.at(-1).id
    const result = await h.tools.get('pg_trust_resolve_unknown').execute({
      unknown_id: unknown.unknown_id, verification_evidence_id: proof,
    }, { agent })
    assert.equal(result.state, 'resolved')
    assert.equal(gate({ name: 'publish_release', agent }), undefined)
    h.events.get('tools/result')(...Object.values(sample(agent, 'code_edit')))
    assert.match(gate({ name: 'publish_release', agent }), /missing-or-stale/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
