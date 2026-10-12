/** Local, append-only, hash-chained evidence without raw tool payload retention. */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, existsSync, openSync, writeSync, fsyncSync, closeSync, lstatSync, constants } from 'node:fs'
import { join } from 'node:path'

const ZERO = '0'.repeat(64)
const CAP = 32 * 1024 * 1024
const sha = x => createHash('sha256').update(x).digest('hex')
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical)
  if (x && typeof x === 'object') {
    const out = {}
    for (const k of Object.keys(x).sort()) if (x[k] !== undefined) out[k] = canonical(x[k])
    return out
  }
  return x
}
export function digest(value) {
  const s = JSON.stringify(canonical(value))
  if (s === undefined) throw new TypeError('expected JSON data')
  return sha(s)
}
export function glob(s) {
  if (typeof s !== 'string' || !s || s.length > 150) throw new TypeError('invalid tool pattern')
  const escape = x => x.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  return new RegExp('^' + s.split('*').map(escape).join('.*') + '$')
}
const any = (patterns, value) => patterns.some(p => p.test(value))
export function policyOf(config = {}) {
  const mode = config.mode ?? 'audit'
  const protectedTools = config.protectedTools ?? []
  const verifierTools = config.verifierTools ?? []
  const mutationTools = config.mutationTools ?? []
  if (!['audit', 'enforce'].includes(mode)) throw new TypeError('invalid trust mode')
  if (![protectedTools, verifierTools, mutationTools].every(xs => Array.isArray(xs) && xs.every(x => typeof x === 'string'))) throw new TypeError('invalid tool patterns')
  if (mode === 'enforce' && (!protectedTools.length || !verifierTools.length)) throw new TypeError('enforce requires protectedTools and verifierTools')
  if ([...protectedTools, ...verifierTools].some(x => x.startsWith('pg_trust_'))) throw new TypeError('trust management tools cannot satisfy or bypass policy')
  return { mode, protectedTools, verifierTools, mutationTools,
    protected: protectedTools.map(glob), verifiers: verifierTools.map(glob), mutations: mutationTools.map(glob) }
}
export class TrustLedger {
  constructor(root, sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('session id required')
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (lstatSync(root).isSymbolicLink()) throw new Error('unsafe trust root')
    this.path = join(root, sha(sessionId) + '.jsonl')
    this.events = []
    this.observations = new Map()
    this.unknowns = new Map()
    this.broken = null
    if (existsSync(this.path)) {
      try {
        if (!lstatSync(this.path).isFile()) throw new Error('not a regular ledger file')
        const bytes = readFileSync(this.path)
        if (bytes.length > CAP || (bytes.length && bytes.at(-1) !== 10)) throw new Error('oversized or truncated ledger')
        for (const line of bytes.toString('utf8').split('\n')) if (line) this.replay(JSON.parse(line))
      } catch (e) { this.broken = String(e?.message ?? e) }
    }
  }
  apply(event) {
    const p = event.payload
    if (p?.kind === 'observation') {
      if (typeof p.tool !== 'string' || typeof p.failed !== 'boolean' || typeof p.arguments_hash !== 'string' || typeof p.result_hash !== 'string') throw new Error('bad observation')
      this.observations.set(event.digest, { ...p, seq: event.seq })
    } else if (p?.kind === 'unknown-open') {
      if (!this.observations.has(p.source) || this.unknowns.has(p.id) || typeof p.question !== 'string' || !p.question) throw new Error('bad unknown')
      this.unknowns.set(p.id, { ...p, seq: event.seq, resolvedBy: null })
    } else if (p?.kind === 'unknown-resolve') {
      const u = this.unknowns.get(p.id), proof = this.observations.get(p.proof)
      if (!u || u.resolvedBy || !proof || proof.failed || proof.seq <= u.seq) throw new Error('bad resolution')
      u.resolvedBy = p.proof
    } else throw new Error('invalid ledger event')
  }
  replay(e) {
    if (!Number.isSafeInteger(e?.seq) || e.seq !== this.events.length + 1 ||
      e.previous !== (this.events.at(-1)?.digest ?? ZERO) ||
      e.digest !== digest({ seq: e.seq, time: e.time, previous: e.previous, payload: e.payload })) throw new Error('ledger hash chain mismatch')
    this.apply(e)
    this.events.push(e)
  }
  append(payload) {
    if (this.broken) throw new Error('trust ledger unavailable: ' + this.broken)
    const e = { seq: this.events.length + 1, time: new Date().toISOString(),
      previous: this.events.at(-1)?.digest ?? ZERO, payload }
    e.digest = digest(e)
    // Validate on a private snapshot BEFORE the irreversible disk append.
    const probe = Object.create(TrustLedger.prototype)
    probe.observations = new Map(this.observations)
    probe.unknowns = new Map([...this.unknowns].map(([k,v]) => [k,{ ...v }]))
    probe.apply(e)
    const bytes = Buffer.from(JSON.stringify(e) + '\n')
    try {
      if (existsSync(this.path) && lstatSync(this.path).size + bytes.length > CAP) throw new Error('ledger size limit')
      const fd = openSync(this.path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600)
      try {
        if (writeSync(fd, bytes) !== bytes.length) throw new Error('short ledger write')
        fsyncSync(fd)
      } finally { closeSync(fd) }
    } catch (err) {
      this.broken = String(err?.message ?? err)
      throw err
    }
    this.apply(e)
    this.events.push(e)
    return e.digest
  }
  observe(exec, result) {
    if (exec.name.startsWith('pg_trust_')) return null
    return this.append({ kind: 'observation', tool: exec.name, failed: result.isError === true,
      arguments_hash: digest(exec.arguments ?? null), result_hash: digest(result),
      call_hash: digest(String(exec.callId ?? 'unknown')) })
  }
  openUnknown(source, question) {
    if (!this.observations.has(source)) throw new Error('source must be existing evidence')
    if (typeof question !== 'string' || !question.trim() || question.length > 240) throw new TypeError('invalid question')
    const id = sha('unknown:' + source + ':' + question.trim())
    if (this.unknowns.has(id)) throw new Error('unknown already exists')
    this.append({ kind: 'unknown-open', id, source, question: question.trim() })
    return id
  }
  resolveUnknown(id, proofId, policy) {
    const u = this.unknowns.get(id), proof = this.observations.get(proofId)
    if (!u || u.resolvedBy) throw new Error('unknown missing or already resolved')
    if (!proof || proof.failed || proof.seq <= u.seq || !any(policy.verifiers, proof.tool)) throw new Error('later successful verifier evidence required')
    this.append({ kind: 'unknown-resolve', id, proof: proofId })
  }
  evaluate(tool, policy) {
    if (!any(policy.protected, tool)) return { allowed: true, reason: 'not-protected' }
    if (this.broken) return { allowed: false, reason: 'ledger-corrupt-or-unavailable' }
    if ([...this.unknowns.values()].some(u => !u.resolvedBy)) return { allowed: false, reason: 'open-unknowns' }
    const mutationSeq = Math.max(0, ...[...this.observations.values()].filter(v => !v.failed && any(policy.mutations, v.tool)).map(v => v.seq))
    for (const verifier of policy.verifiers) {
      if (![...this.observations.values()].some(v => !v.failed && v.seq > mutationSeq && verifier.test(v.tool))) {
        return { allowed: false, reason: 'missing-or-stale-verification' }
      }
    }
    return { allowed: true, reason: 'verification-evidence-present' }
  }
  status(policy) {
    return { mode: policy.mode, integrity: this.broken ? 'unavailable' : 'ok',
      records: this.events.length, observations: this.observations.size,
      open_unknowns: [...this.unknowns.values()].filter(u => !u.resolvedBy).map(u => ({ id: u.id, question: u.question, source: u.source })),
      evidence: [...this.observations].slice(-20).map(([id,v]) => ({ id, tool: v.tool, failed: v.failed, seq: v.seq })),
      protected_tools: policy.protectedTools, verifier_tools: policy.verifierTools }
  }
}
