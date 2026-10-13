import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TrustLedger, policyOf, glob, digest } from './ledger.mjs'

const withLedger = fn => {
  const root = mkdtempSync(join(tmpdir(), 'pg-trust-'))
  try { return fn(new TrustLedger(root, 'session/test'), root) }
  finally { rmSync(root, { recursive: true, force: true }) }
}
const ok = (tool, args = { sensitive: 'secret-value' }) =>
  ({ exec: { name: tool, arguments: args, callId: 'call-1' }, result: { isError: false, content: [{ type: 'text', text: 'secret-output' }] } })
const policy = policyOf({ mode: 'enforce', protectedTools: ['publish_*'],
  verifierTools: ['ci_verify'], mutationTools: ['edit_*'] })

test('canonical hashes do not depend on object property insertion order', () => {
  assert.equal(digest({ b: 1, a: { d: 3, c: 2 } }), digest({ a: { c: 2, d: 3 }, b: 1 }))
  assert.equal(glob('tool_*').test('tool_bash'), true)
  assert.equal(glob('a.b').test('axb'), false)
})
test('audit is the safe default; enforcement requires explicit verifier', () => {
  assert.equal(policyOf().mode, 'audit')
  assert.throws(() => policyOf({ mode: 'enforce', protectedTools: ['deploy'] }), /verifier/)
  assert.throws(() => policyOf({ verifierTools: ['pg_trust_status'] }), /management/)
})
test('write-only hashes replay; secrets never enter the ledger', () => withLedger((l, root) => {
  const sample = ok('edit_file')
  const evidence = l.observe(sample.exec, sample.result)
  assert.equal(typeof evidence, 'string')
  const persisted = readFileSync(l.path, 'utf8')
  assert.ok(!persisted.includes('secret-value'))
  assert.ok(!persisted.includes('secret-output'))
  const again = new TrustLedger(root, 'session/test')
  assert.equal(again.status(policy).observations, 1)
  assert.equal(again.status(policy).integrity, 'ok')
}))
test('gate fails until verifier runs after last mutation; unknowns require later verified evidence', () => withLedger(l => {
  assert.equal(l.evaluate('publish_release', policy).allowed, false)
  const source = ok('edit_file')
  const e0 = l.observe(source.exec, source.result)
  const e1 = l.observe(ok('ci_verify').exec, ok('ci_verify').result)
  assert.equal(l.evaluate('publish_release', policy).allowed, true)
  const id = l.openUnknown(e0, 'Is cancellation handled?')
  assert.equal(l.evaluate('publish_release', policy).reason, 'open-unknowns')
  assert.throws(() => l.resolveUnknown(id, e1, policy), /later successful/)
  const e2 = l.observe(ok('ci_verify').exec, ok('ci_verify').result)
  l.resolveUnknown(id, e2, policy)
  assert.equal(l.evaluate('publish_release', policy).allowed, true)
  l.observe(ok('edit_second').exec, ok('edit_second').result)
  assert.equal(l.evaluate('publish_release', policy).reason, 'missing-or-stale-verification')
  // A failed write may still partially mutate a file: it must also stale proof.
  l.observe(ok('ci_verify').exec, ok('ci_verify').result)
  assert.equal(l.evaluate('publish_release', policy).allowed, true)
  l.observe(ok('edit_failed').exec, { isError: true, content: [{ type: 'text', text: 'failed' }] })
  assert.equal(l.evaluate('publish_release', policy).reason, 'missing-or-stale-verification')
  assert.equal(l.evaluate('list_files', policy).allowed, true)
}))
test('corrupt, truncated or mismatched ledger blocks a protected tool after restart', () => withLedger((l, root) => {
  const s = ok('ci_verify')
  l.observe(s.exec, s.result)
  appendFileSync(l.path, '{"broken":')
  const loaded = new TrustLedger(root, 'session/test')
  assert.equal(loaded.status(policy).integrity, 'unavailable')
  assert.equal(loaded.evaluate('publish_release', policy).allowed, false)
  assert.throws(() => loaded.observe(s.exec, s.result), /unavailable/)
}))

test('reconfiguring verifier invalidates an old unknown resolution until reverified', () => withLedger(l => {
  const src = l.observe(ok('edit_file').exec, ok('edit_file').result)
  const unknownId = l.openUnknown(src, 'Was rollback verified?')
  const proof = l.observe(ok('ci_verify').exec, ok('ci_verify').result)
  l.resolveUnknown(unknownId, proof, policy)
  const newer = policyOf({ mode: 'enforce', protectedTools: ['publish_*'], verifierTools: ['ci_verify_new'] })
  assert.equal(l.evaluate('publish_release', newer).reason, 'unknown-resolution-needs-reverification')
  const updated = l.observe(ok('ci_verify_new').exec, ok('ci_verify_new').result)
  l.resolveUnknown(unknownId, updated, newer)
  assert.equal(l.evaluate('publish_release', newer).allowed, true)
}))

test('single writer lock serializes commits and preserves replay sequence', () => withLedger((ledger, root) => {
  const evidence = ok('read_only')
  assert.equal(existsSync(ledger.lockPath), false)
  ledger.observe(evidence.exec, evidence.result)
  assert.equal(existsSync(ledger.lockPath), false)
  ledger.observe(evidence.exec, evidence.result)
  const restart = new TrustLedger(root, 'session/test')
  assert.equal(restart.status(policy).integrity, 'ok')
  assert.equal(restart.status(policy).observations, 2)
}))

test('second stale instance cannot overwrite first instance hash-chain head', () => withLedger((first, root) => {
  const stale = new TrustLedger(root, 'session/test')
  const row = ok('read_only')
  first.observe(row.exec, row.result)
  assert.throws(() => stale.observe(row.exec, row.result), /stale-ledger-writer/)
  assert.equal(stale.status(policy).integrity, 'unavailable')
  const openedDuringUncertainWrite = new TrustLedger(root, 'session/test')
  assert.equal(openedDuringUncertainWrite.broken, 'unfinished-ledger-writer')
  assert.equal(openedDuringUncertainWrite.evaluate('publish_release', policy).allowed, false)
}))

test('same-length tail tampering blocks the current in-memory writer', () => withLedger(l => {
  const row = ok('read_only')
  l.observe(row.exec, row.result)
  const raw = readFileSync(l.path, 'utf8')
  assert.ok(raw.includes('read_only'))
  writeFileSync(l.path, raw.replace('read_only', 'edit_file'))
  assert.throws(() => l.observe(row.exec, row.result), /stale-ledger-tail/)
  assert.equal(l.evaluate('publish_release', policy).allowed, false)
}))
