import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { apply } from './index.js'
import { signEnvelope } from './sign-attestation.mjs'

function harness() {
  const events = new Map(), tools = new Map()
  let guard
  const ctx = {
    on(name, handler) { events.set(name, handler) },
    tools: {
      guard(handler) { guard = handler },
      register(definition) { tools.set(definition.name, definition) },
    },
    root: { loader: { import: async () => ({ defineTool: x => x }) } },
  }
  return { ctx, events, tools, guard: () => guard }
}
const event = (agent, name, failed = false) => ({
  exec: { agent, name, callId: name, arguments: { token:'SECRET_IN_ARGS' } },
  result: { isError: failed, content: [{ type:'text', text:'SECRET_IN_RESULT' }] },
})
const fields = ['repository','commit_sha','artifact_sha256','run_id']
const release = {
  repository:'xxxxxwater/PureGamma-harness', commit_sha:'c'.repeat(40),
  artifact_sha256:'d'.repeat(64), run_id:'98765',
}
const keys = generateKeyPairSync('ed25519')
const publicKeyPem = keys.publicKey.export({ format:'pem', type:'spki' })
const privateKeyPem = keys.privateKey.export({ format:'pem', type:'pkcs8' })

test('audit observes results without blocking, tools surface no raw outputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pg-index-'))
  try {
    const h = harness()
    await apply(h.ctx, { root })
    const agent = { session: { id:'agent-A' } }
    const record = event(agent, 'file_read')
    h.events.get('tools/result')(record.exec, record.result)
    assert.equal(h.guard()({ name:'publish_release', agent }), undefined)
    const status = await h.tools.get('pg_trust_status').execute({}, { agent })
    assert.equal(status.observations, 1)
    assert.equal(status.integrity, 'ok')
    assert.equal(status.verification_generation, 2)
    assert.equal(h.tools.size, 6)
    assert.equal(JSON.stringify(status).includes('SECRET'), false)
    const preview = await h.tools.get('pg_trust_check_gate').execute({
      target_tool:'publish_release', target_arguments:release,
    }, { agent })
    assert.equal(preview.effective_allow, true)
  } finally { rmSync(root, { recursive:true, force:true }) }
})

test('signed CI proof can cross session boundary; no generic success bypass', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pg-index-'))
  try {
    const h = harness()
    await apply(h.ctx, {
      root, mode:'enforce',
      attestations: {
        trustedKeys:[{ id:'ci', publicKeyPem, kinds:['release'] }],
        release: {
          tools:['publish_release'], repository:release.repository, workflow:'Trusted Build',
          paths:Object.fromEntries(fields.map(x=>[x,x])), maxAgeSeconds:600,
        },
      },
    })
    const agent1 = { session: { id:'session-1' } }
    const agent2 = { session: { id:'session-2' } }
    const gate = h.guard()
    assert.match(gate({ name:'publish_release', arguments:release, agent:agent1 }), /no-matching/)
    assert.match(gate({ name:'publish_release', arguments:release }), /missing-agent/)
    const envelope = signEnvelope({
      kind:'release', ...release, workflow:'Trusted Build', conclusion:'success',
      issued_at:new Date(Date.now()-1000).toISOString(),
      expires_at:new Date(Date.now()+50000).toISOString(),
    }, privateKeyPem, 'ci')
    const imported = await h.tools.get('pg_trust_import_attestation').execute({ envelope }, { agent:agent1 })
    assert.equal(imported.kind, 'release')
    assert.equal(gate({ name:'publish_release', arguments:release, agent:agent2 }), undefined)
    assert.match(gate({ name:'publish_release', arguments:{ ...release, commit_sha:'a'.repeat(40) }, agent:agent2 }), /no-matching/)
    const source = event(agent1, 'read_file')
    h.events.get('tools/result')(source.exec, source.result)
    const sourceId = (await h.tools.get('pg_trust_status').execute({}, { agent:agent1 })).evidence.at(-1).id
    await h.tools.get('pg_trust_link_evidence').execute({
      source_session_id:'session-1', source_evidence_id:sourceId,
    }, { agent:agent2 })
    const linkedStatus = await h.tools.get('pg_trust_status').execute({}, { agent:agent2 })
    assert.equal(linkedStatus.linked_evidence, 1)
  } finally { rmSync(root, { recursive:true, force:true }) }
})

test('unsafe legacy-only enforce configuration fails closed at plugin startup', async () => {
  const h = harness()
  await assert.rejects(() => apply(h.ctx, {
    mode:'enforce', protectedTools:['publish_*'], verifierTools:['ci_check'],
  }), /trusted Ed25519/)
})

test('recording failure poisons session for a previously valid signed release', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pg-index-'))
  try {
    const h = harness()
    await apply(h.ctx, { root, mode:'enforce', attestations:{
      trustedKeys:[{ id:'ci', publicKeyPem, kinds:['release'] }],
      release: { tools:['publish_release'], repository:release.repository,
        workflow:'Trusted Build', paths:Object.fromEntries(fields.map(x=>[x,x])),
        maxAgeSeconds:600 },
    } })
    const agent = { session:{ id:'failed-recording' } }
    const envelope = signEnvelope({
      kind:'release', ...release, conclusion:'success',
      issued_at:new Date(Date.now()-1000).toISOString(),
      expires_at:new Date(Date.now()+50000).toISOString(),
    }, privateKeyPem, 'ci')
    await h.tools.get('pg_trust_import_attestation').execute({ envelope }, { agent })
    assert.equal(h.guard()({ name:'publish_release', arguments:release, agent }), undefined)
    // A malformed output would normally be rejected by ToolRuntime; this
    // exercises the observer's own last-resort error containment.
    h.events.get('tools/result')({ agent, name:'some_tool', arguments:{}, callId:'1' },
      { isError:false, value:1n, content:[] })
    assert.match(h.guard()({ name:'publish_release', arguments:release, agent }), /ledger-corrupt/)
  } finally { rmSync(root, { recursive:true, force:true }) }
})
