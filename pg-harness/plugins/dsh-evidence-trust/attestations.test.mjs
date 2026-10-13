import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TrustLedger, policyOf, digest } from './ledger.mjs'
import { AttestationVault, configureAttestations, verifyEnvelope } from './attestations.mjs'
import { SignedGate } from './signed-gate.mjs'
import { signEnvelope } from './sign-attestation.mjs'

const keys = generateKeyPairSync('ed25519')
const pub = keys.publicKey.export({ type: 'spki', format: 'pem' })
const priv = keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
const stamp = (now, diff) => new Date(now + diff).toISOString()
const paths = names => Object.fromEntries(names.map(name => [name, name]))
const RELEASE_PATHS = paths(['repository','commit_sha','artifact_sha256','run_id','workflow'])
const TRADE_PATHS = paths(['venue','account','symbol','side','quantity','price','notional_usd','leverage','reduce_only','client_order_id'])
const POLICY = {
  mode: 'enforce',
  protectedTools: ['unclassified_*'],
  attestations: {
    trustedKeys: [{ id: 'ci-v1', publicKeyPem: pub, kinds: ['release','trade'] }],
    release: { tools: ['publish_release'], repository: 'xxxxxwater/PureGamma-harness',
      workflow: 'CI Verified Build', paths: RELEASE_PATHS, maxAgeSeconds: 1800 },
    trade: { tools: ['trade_place'], paths: TRADE_PATHS, allowedVenues: ['binance-pm'],
      allowedAccounts: ['paper-1'], maxNotionalUsd: 1000, maxLeverage: 3, linearContracts: { BTCUSDT: 1 }, maxAgeSeconds: 120 },
  },
}
const release = {
  repository: 'xxxxxwater/PureGamma-harness', commit_sha: 'a'.repeat(40),
  artifact_sha256: 'b'.repeat(64), run_id: '123456', workflow: 'CI Verified Build',
}
const order = {
  venue: 'binance-pm', account: 'paper-1', symbol: 'BTCUSDT', side: 'BUY',
  quantity: 0.01, price: 80000, notional_usd: 800, leverage: 2,
  reduce_only: false, client_order_id: 'paper-order-1',
}
const releasePayload = (now = Date.now()) => ({
  kind: 'release', ...release, conclusion: 'success',
  issued_at: stamp(now, -1000), expires_at: stamp(now, 120000),
})
const tradePayload = (now = Date.now()) => ({
  kind: 'trade', order_sha256: digest(order), venue: order.venue, account: order.account,
  symbol: order.symbol, notional_usd: order.notional_usd, leverage: order.leverage,
  decision: 'allow', issued_at: stamp(now, -1000), expires_at: stamp(now, 90000),
})
const withState = fn => {
  const root = mkdtempSync(join(tmpdir(), 'pg-attested-'))
  try {
    const policy = policyOf(POLICY)
    const cfg = configureAttestations(POLICY.attestations, policy.mode)
    const vault = new AttestationVault(root, cfg)
    const gate = new SignedGate(policy, cfg, vault)
    const ledger = new TrustLedger(root, 'session-A')
    return fn({ root, vault, gate, ledger, policy, cfg })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const invoke = (name, args) => ({ name, arguments: args })

test('enforce refuses absent keys, invalid signing algorithms and incomplete binding paths', () => {
  assert.throws(() => configureAttestations({}, 'enforce'), /requires trusted/)
  assert.throws(() => configureAttestations({ ...POLICY.attestations, trustedKeys: [] }, 'enforce'), /requires trusted/)
  assert.throws(() => configureAttestations({ ...POLICY.attestations,
    release: { ...POLICY.attestations.release, paths: { repository: 'repository' } },
  }, 'enforce'), /missing-or-extra/)
  assert.throws(() => configureAttestations({ ...POLICY.attestations,
    trade: { ...POLICY.attestations.trade, linearContracts: undefined },
  }, 'enforce'), /linearContracts/)
  assert.throws(() => configureAttestations({ ...POLICY.attestations,
    trade: { ...POLICY.attestations.trade, linearContracts: { BTCUSDT: -1 } },
  }, 'enforce'), /linear-contract/)
})

test('release requires valid Ed25519 CI signature with exact commit/artifact/run/workflow', () => withState(({ gate, ledger, vault, cfg }) => {
  assert.equal(gate.decide(invoke('publish_release', release), ledger).allowed, false)
  const envelope = signEnvelope(releasePayload(), priv, 'ci-v1')
  assert.equal(verifyEnvelope(envelope, cfg).kind, 'release')
  const imported = vault.import(envelope)
  assert.equal(imported.kind, 'release')
  assert.equal(gate.decide(invoke('publish_release', release), ledger).allowed, true)
  for (const key of ['commit_sha','artifact_sha256','run_id','repository']) {
    assert.equal(gate.decide(invoke('publish_release', { ...release, [key]: 'not-matching' }), ledger).allowed, false, key)
  }
  assert.equal(gate.decide(invoke('publish_release', { ...release, workflow: 'another' }), ledger).allowed, false)
  assert.equal(gate.decide(invoke('publish_release', { ...release, force: true }), ledger).reason, 'unbound-tool-arguments')
  assert.equal(gate.decide(invoke('unclassified_deploy', release), ledger).reason, 'unclassified-or-ambiguous-protected-tool')
  const tampered = { ...envelope, payload: { ...envelope.payload, commit_sha: 'c'.repeat(40) } }
  assert.throws(() => vault.import(tampered), /signature-failed/)
  const wrongId = { ...envelope, key_id: 'nobody' }
  assert.throws(() => vault.import(wrongId), /untrusted/)
  assert.ok(!readFileSync(vault.root + '/' + imported.id + '.json', 'utf8').includes(priv))
}))

test('expiration, future issuance and invalid claims fail closed', () => withState(({ vault }) => {
  const now = Date.now()
  assert.throws(() => vault.import(signEnvelope({
    ...releasePayload(now), issued_at: stamp(now,-300000), expires_at: stamp(now,-1000),
  }, priv, 'ci-v1'), now), /expired/)
  assert.throws(() => vault.import(signEnvelope({
    ...releasePayload(now), issued_at: stamp(now, 60000), expires_at: stamp(now,120000),
  }, priv,'ci-v1'), now), /expired/)
  assert.throws(() => vault.import(signEnvelope({ ...releasePayload(now), conclusion:'failure' }, priv, 'ci-v1'), now), /release-claims/)
  assert.throws(() => vault.import(signEnvelope({ ...releasePayload(now), unexpected:'x' }, priv, 'ci-v1'), now), /payload/)
}))

test('trade intent requires exact signed order; one-time reservation survives reload and session switch', () => withState(({ gate, ledger, vault, root }) => {
  const att = vault.import(signEnvelope(tradePayload(), priv, 'ci-v1'))
  assert.equal(gate.decide(invoke('trade_place', order), ledger, false).allowed, true)
  const result = gate.decide(invoke('trade_place', order), ledger, true)
  assert.equal(result.allowed, true)
  assert.equal(result.proof_id, att.id)
  assert.equal(gate.decide(invoke('trade_place', order), new TrustLedger(root, 'session-B'), true).allowed, false)
  assert.equal(gate.decide(invoke('trade_place', { ...order, quantity: 0.02 }), ledger).allowed, false)
  assert.equal(gate.decide(invoke('trade_place', { ...order, account: 'another-account' }), ledger).allowed, false)
  assert.equal(gate.decide(invoke('trade_place', { ...order, notional_usd: 1001 }), ledger).allowed, false)
  // A signed order claiming $800 of exposure cannot carry a $80,000 or
  // $8,000 base-quantity exposure; the local guard derives linear notional.
  assert.equal(gate.decide(invoke('trade_place', { ...order, quantity: 0.1 }), ledger).reason, 'trade-notional-mismatch-or-limit')
  assert.equal(gate.decide(invoke('trade_place', { ...order, notional_usd: 8 }), ledger).reason, 'trade-notional-mismatch-or-limit')
  assert.equal(gate.decide(invoke('trade_place', { ...order, symbol: 'ETHUSDT' }), ledger).reason, 'unsupported-or-unpriced-trading-symbol')
  assert.equal(gate.decide(invoke('trade_place', { ...order, price: 80160 }), ledger).reason, 'trade-notional-mismatch-or-limit')
  assert.equal(gate.decide(invoke('trade_place', { ...order, leverage: 6 }), ledger).allowed, false)
  assert.equal(gate.decide(invoke('trade_place', { ...order, reduce_only: true }), ledger).allowed, false)
  assert.equal(gate.decide(invoke('trade_place', { ...order, client_order_id: 'reuse-with-new-id' }), ledger).allowed, false)
  const refreshed = new AttestationVault(root, vault.cfg)
  const gate2 = new SignedGate(policyOf(POLICY), vault.cfg, refreshed)
  assert.equal(gate2.decide(invoke('trade_place', order), new TrustLedger(root, 'session-C'), true).allowed, false)
}))

test('cross-session links are historical; only signed resolution matches gated proof', () => withState(({ root, vault, gate, ledger }) => {
  const x = ledger.observe({ name:'read_file', arguments:{secret:'do-not-store'}, callId:'1' },
    { isError:false, content:[{ type:'text', text:'private output' }] })
  const other = new TrustLedger(root, 'session-B')
  const linked = other.linkEvidence('session-A', x)
  assert.equal(other.status(policyOf(POLICY)).linked_evidence, 1)
  assert.equal(typeof linked, 'string')
  assert.equal(gate.decide(invoke('publish_release', release), other).allowed, false)
  const unknown = ledger.openUnknown(x, 'Unverified migration')
  const legacy = ledger.observe({ name:'ci_verify', arguments:{}, callId:'2' },
    { isError:false, content:[] })
  const old = policyOf({ mode:'audit', verifierTools:['ci_verify'] })
  ledger.resolveUnknown(unknown, legacy, old)
  const minted = { ...releasePayload(),
    issued_at: new Date(Date.now() + 1000).toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString() }
  vault.import(signEnvelope(minted,priv,'ci-v1'))
  assert.equal(gate.decide(invoke('publish_release', release), ledger).reason, 'open-or-stale-signed-unknowns')
  const proof = vault.list()[0]
  ledger.resolveUnknownSigned(unknown, proof)
  assert.equal(gate.decide(invoke('publish_release', release), ledger).allowed, true)
  const restart = new TrustLedger(root, 'session-A')
  assert.equal(restart.status(old).integrity, 'ok')
  assert.equal(restart.status(old).linked_evidence, 0)
  assert.equal(gate.decide(invoke('publish_release', release), restart).allowed, true)
}))
