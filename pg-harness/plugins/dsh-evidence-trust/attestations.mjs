/**
 * Signed, target-bound attestations. Caller-supplied tool success is never
 * authoritative. Only Ed25519 signatures from explicitly pinned public keys
 * can authorize release/trade execution.
 */
import { createHash, createPublicKey, verify } from 'node:crypto'
import { constants, mkdirSync, existsSync, lstatSync, readFileSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { digest, glob } from './ledger.mjs'

const PREFIX = 'PureGamma.Trust.Attestation.v1\n'
const HEX64 = /^[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40}$/
const KEY_ID = /^[a-zA-Z0-9_.-]{1,64}$/
const RUN_ID = /^[1-9][0-9]{0,19}$/
const MAX_FILE_BYTES = 32 * 1024
const sha = value => createHash('sha256').update(value).digest('hex')
const match = (patterns, name) => patterns.some(p => p.test(name))

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered)
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value).sort()) {
      if (value[k] !== undefined) out[k] = ordered(value[k])
    }
    return out
  }
  return value
}
export const signedBytes = payload => Buffer.from(PREFIX + JSON.stringify(ordered(payload)), 'utf8')

function exactKeys(input, keys) {
  return input && typeof input === 'object' && !Array.isArray(input) &&
    Object.keys(input).length === keys.length && keys.every(k => Object.hasOwn(input, k))
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) throw new Error('invalid-attestation-time')
  const n = Date.parse(value)
  if (!Number.isFinite(n)) throw new Error('invalid-attestation-time')
  return n
}
function numeric(value, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('invalid-numeric-binding')
  }
  return value
}
function text(value, max = 160) {
  if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error('invalid-string-binding')
  }
  return value
}
function runId(value) {
  const s = String(value)
  if (!RUN_ID.test(s)) throw new Error('invalid-run-id')
  return s
}
function pathValue(input, key) {
  if (typeof key !== 'string' || !/^[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*){0,4}$/.test(key)) throw new TypeError('invalid-binding-path')
  return key.split('.').reduce((value, part) =>
    value && typeof value === 'object' && Object.hasOwn(value, part) ? value[part] : undefined, input)
}
function requiredMapping(keys, fields) {
  if (!keys || !exactKeys(keys, fields)) throw new TypeError('missing-or-extra-binding-path')
  for (const key of fields) pathValue({}, keys[key])
  const pathList = Object.values(keys)
  if (new Set(pathList).size !== fields.length ||
    pathList.some(a => pathList.some(b => a !== b && b.startsWith(a + '.')))) {
    throw new TypeError('overlapping-or-duplicate-binding-path')
  }
  return Object.freeze({ ...keys })
}
/** Refuse extra tool arguments not covered by the exact signed binding shape. */
function requireExactBindingShape(args, paths) {
  const shape = Object.create(null)
  for (const dotted of Object.values(paths)) {
    const pieces = dotted.split('.')
    let node = shape
    for (const piece of pieces) {
      if (['__proto__','constructor','prototype'].includes(piece)) throw new Error('unsafe-binding-path')
      node[piece] ??= Object.create(null)
      node = node[piece]
    }
  }
  const examine = (value, expected) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== Object.keys(expected).length) throw new Error('unbound-tool-arguments')
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(expected, key)) throw new Error('unbound-tool-arguments')
      if (Object.keys(expected[key]).length) examine(value[key], expected[key])
    }
  }
  examine(args, shape)
}
export const RELEASE_FIELDS = ['repository','commit_sha','artifact_sha256','run_id','workflow']
export const TRADE_FIELDS = [
  'venue', 'account', 'symbol', 'side', 'quantity', 'price',
  'notional_usd', 'leverage', 'reduce_only', 'client_order_id',
]

export function configureAttestations(config = {}, mode = 'audit') {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('attestations config must be an object')
  const keys = new Map()
  for (const item of config.trustedKeys ?? []) {
    if (!item || !KEY_ID.test(item.id) || keys.has(item.id) || !Array.isArray(item.kinds) ||
      !item.kinds.length || item.kinds.some(k => !['release','trade'].includes(k))) throw new TypeError('invalid pinned key')
    const publicKey = createPublicKey(item.publicKeyPem)
    if (publicKey.asymmetricKeyType !== 'ed25519') throw new TypeError('only Ed25519 trusted keys are supported')
    keys.set(item.id, { publicKey, kinds: new Set(item.kinds) })
  }
  const release = config.release
    ? {
        tools: (config.release.tools ?? []).map(glob),
        paths: requiredMapping(config.release.paths, RELEASE_FIELDS),
        repository: text(config.release.repository),
        workflow: text(config.release.workflow),
        maxAgeSeconds: numeric(config.release.maxAgeSeconds ?? 86400, 1, 86400),
      }
    : null
  const trade = config.trade
    ? {
        tools: (config.trade.tools ?? []).map(glob),
        paths: requiredMapping(config.trade.paths, TRADE_FIELDS),
        allowedVenues: new Set((config.trade.allowedVenues ?? []).map(x => text(x))),
        allowedAccounts: new Set((config.trade.allowedAccounts ?? []).map(x => text(x))),
        maxNotionalUsd: numeric(config.trade.maxNotionalUsd, 0.01, 1e12),
        maxLeverage: numeric(config.trade.maxLeverage, 1, 1000),
        maxAgeSeconds: numeric(config.trade.maxAgeSeconds ?? 120, 1, 300),
      }
    : null
  if (mode === 'enforce' && (keys.size === 0 || (!release?.tools.length && !trade?.tools.length))) {
    throw new TypeError('enforce requires trusted Ed25519 keys and release or trade tool bindings')
  }
  if (release && trade && release.tools.some(p => trade.tools.some(q => String(p) === String(q)))) {
    throw new TypeError('ambiguous release/trade tool mapping')
  }
  if (trade && (!trade.allowedVenues.size || !trade.allowedAccounts.size)) throw new TypeError('trade requires pinned venue and account allowlists')
  return { keys, release, trade }
}

export function releaseTarget(args, policy) {
  requireExactBindingShape(args, policy.paths)
  const values = Object.fromEntries(RELEASE_FIELDS.map(k => [k, pathValue(args, policy.paths[k])]))
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(values.repository) || values.repository !== policy.repository || values.workflow !== policy.workflow) throw new Error('release-repository-or-workflow-mismatch')
  if (!COMMIT.test(values.commit_sha) || !HEX64.test(values.artifact_sha256)) throw new Error('release-digest-invalid')
  return { ...values, run_id: runId(values.run_id) }
}
export function tradeTarget(args, policy) {
  requireExactBindingShape(args, policy.paths)
  const values = Object.fromEntries(TRADE_FIELDS.map(k => [k, pathValue(args, policy.paths[k])]))
  for (const k of ['venue','account','symbol','side','client_order_id']) text(values[k])
  if (!policy.allowedVenues.has(values.venue) || !policy.allowedAccounts.has(values.account)) throw new Error('trade-account-or-venue-not-allowed')
  if (!/^[A-Z0-9_./:-]{2,40}$/.test(values.symbol) || !['BUY','SELL'].includes(values.side)) throw new Error('invalid-trade-symbol-or-side')
  for (const k of ['quantity','price','notional_usd','leverage']) numeric(values[k], Number.EPSILON, 1e12)
  if (typeof values.reduce_only !== 'boolean') throw new Error('reduce-only-missing')
  if (values.notional_usd > policy.maxNotionalUsd || values.leverage > policy.maxLeverage) throw new Error('trade-policy-limit')
  return values
}

export function verifyEnvelope(envelope, cfg, now = Date.now()) {
  if (!exactKeys(envelope, ['schema','key_id','payload','signature']) ||
    envelope.schema !== 'pg.trust.attestation.v1' || !KEY_ID.test(envelope.key_id)) throw new Error('invalid-attestation-envelope')
  const payload = envelope.payload
  if (!payload || !['release','trade'].includes(payload.kind)) throw new Error('unsupported-attestation-kind')
  const pinned = cfg.keys.get(envelope.key_id)
  if (!pinned || !pinned.kinds.has(payload.kind)) throw new Error('untrusted-signing-key')
  const allowedKeys = payload.kind === 'release'
    ? ['kind','repository','commit_sha','artifact_sha256','run_id','workflow','conclusion','issued_at','expires_at']
    : ['kind','order_sha256','venue','account','symbol','notional_usd','leverage','decision','issued_at','expires_at']
  if (!exactKeys(payload, allowedKeys)) throw new Error('invalid-attestation-payload')
  const maxAge = payload.kind === 'release' ? cfg.release?.maxAgeSeconds : cfg.trade?.maxAgeSeconds
  if (!maxAge) throw new Error('attestation-kind-not-configured')
  const issued = timestamp(payload.issued_at), expires = timestamp(payload.expires_at)
  if (issued > now + 30000 || expires <= now || expires <= issued || expires - issued > maxAge * 1000) throw new Error('expired-or-unbounded-attestation')
  if (typeof envelope.signature !== 'string' ||
    !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) throw new Error('invalid-attestation-signature')
  const signature = Buffer.from(envelope.signature, 'base64')
  if (signature.length !== 64 || !verify(null, signedBytes(payload), pinned.publicKey, signature)) throw new Error('attestation-signature-failed')
  if (payload.kind === 'release') {
    if (payload.conclusion !== 'success' || !COMMIT.test(payload.commit_sha) || !HEX64.test(payload.artifact_sha256) ||
      !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(payload.repository)) throw new Error('invalid-release-claims')
    runId(payload.run_id); text(payload.workflow)
  } else {
    if (payload.decision !== 'allow' || !HEX64.test(payload.order_sha256)) throw new Error('invalid-trade-claims')
    for (const k of ['venue','account','symbol']) text(payload[k])
    numeric(payload.notional_usd, Number.EPSILON, 1e12)
    numeric(payload.leverage, 1, 1000)
  }
  return { id: sha(signedBytes(payload).toString('hex') + ':' + envelope.signature + ':' + envelope.key_id),
    kind: payload.kind, payload }
}

/**
 * Shared immutable proof store. Importing in one session makes a signature
 * visible to other sessions on this same host; no unsigned status crosses
 * this boundary. Trade grants are spent with an atomic O_EXCL reservation.
 */
export class AttestationVault {
  constructor(root, cfg) {
    this.root = join(root, 'attestations-v1')
    this.cfg = cfg
    mkdirSync(this.root, { recursive: true, mode: 0o700 })
    if (lstatSync(this.root).isSymbolicLink()) throw new Error('unsafe-attestation-root')
  }
  checked(envelope, now) { return verifyEnvelope(envelope, this.cfg, now) }
  import(envelope, now = Date.now()) {
    const verified = this.checked(envelope, now)
    const file = join(this.root, verified.id + '.json')
    const data = Buffer.from(JSON.stringify(envelope) + '\n')
    if (data.length > MAX_FILE_BYTES) throw new Error('attestation-too-large')
    if (!existsSync(file)) {
      try {
        const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
        try { if (writeSync(fd, data) !== data.length) throw new Error('attestation-short-write'); fsyncSync(fd) }
        finally { closeSync(fd) }
      } catch (e) {
        if (e?.code !== 'EEXIST') throw e
      }
    }
    // Always re-read and verify from disk, including concurrent imports.
    this.read(verified.id, now)
    return { id: verified.id, kind: verified.kind, expires_at: verified.payload.expires_at }
  }
  read(id, now = Date.now()) {
    if (!HEX64.test(id)) throw new Error('invalid-proof-id')
    const file = join(this.root, id + '.json')
    if (!lstatSync(file).isFile() || lstatSync(file).size > MAX_FILE_BYTES) throw new Error('invalid-proof-file')
    const envelope = JSON.parse(readFileSync(file, 'utf8'))
    const checked = this.checked(envelope, now)
    if (checked.id !== id) throw new Error('proof-integrity-mismatch')
    return checked
  }
  list(now = Date.now()) {
    // Only valid, unexpired and cryptographically verified envelopes qualify.
    return listProofs(this.root, id => this.read(id, now))
  }
  authorize(kind, target, maxAgeSeconds, now = Date.now()) {
    for (const proof of this.list(now)) {
      if (proof.kind !== kind) continue
      const p = proof.payload
      if (now - timestamp(p.issued_at) > maxAgeSeconds * 1000) continue
      if (kind === 'release') {
        if (p.repository === target.repository && p.commit_sha === target.commit_sha &&
          p.artifact_sha256 === target.artifact_sha256 && p.run_id === target.run_id &&
          p.workflow === target.workflow) return { allowed: true, proof_id: proof.id }
      } else if (!existsSync(join(this.root, digest(target) + '.spent')) &&
        p.order_sha256 === digest(target) && p.venue === target.venue &&
        p.account === target.account && p.symbol === target.symbol &&
        p.notional_usd === target.notional_usd && p.leverage === target.leverage) {
        return { allowed: true, proof_id: proof.id }
      }
    }
    return { allowed: false, reason: 'no-matching-signed-attestation' }
  }
  reserveTrade(orderDigest) {
    if (!HEX64.test(orderDigest)) throw new Error('invalid-trade-intent')
    const file = join(this.root, orderDigest + '.spent')
    const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
    try { writeSync(fd, Buffer.from('spent\n')); fsyncSync(fd) } finally { closeSync(fd) }
  }
}

import { readdirSync } from 'node:fs'
function listProofs(root, read) {
  const rows = []
  for (const name of readdirSync(root)) {
    if (!/^[0-9a-f]{64}\.json$/.test(name)) continue
    try { rows.push(read(name.slice(0,64))) } catch {
      // Expired or damaged proofs never authorize. Caller can inspect the
      // refusal and reissue an independent attestation.
    }
  }
  return rows
}
