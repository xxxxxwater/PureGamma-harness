/** Local, append-only, hash-chained evidence without raw tool payload retention. */
import { createHash } from 'node:crypto'
import { mkdirSync, rmdirSync, readFileSync, existsSync, openSync, writeSync, readSync, fsyncSync, closeSync, fstatSync, lstatSync, constants } from 'node:fs'
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
  const signedRules = Boolean(config.attestations?.release?.tools?.length || config.attestations?.trade?.tools?.length)
  if (mode === 'enforce' && !signedRules && (!protectedTools.length || !verifierTools.length)) throw new TypeError('enforce requires signed tool rules or legacy protectedTools and verifierTools')
  if ([...protectedTools, ...verifierTools].some(x => x.startsWith('pg_trust_'))) throw new TypeError('trust management tools cannot satisfy or bypass policy')
  return { mode, protectedTools, verifierTools, mutationTools,
    protected: protectedTools.map(glob), verifiers: verifierTools.map(glob), mutations: mutationTools.map(glob) }
}
export class TrustLedger {
  constructor(root, sessionId) {
    if (typeof sessionId !== 'string' || !sessionId) throw new TypeError('session id required')
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (lstatSync(root).isSymbolicLink()) throw new Error('unsafe trust root')
    this.root = root
    this.path = join(root, sha(sessionId) + '.jsonl')
    this.lockPath = this.path + '.writer-lock'
    this.persistedSize = 0
    this.persistedTail = Buffer.alloc(0)
    this.events = []
    this.observations = new Map()
    this.unknowns = new Map()
    this.links = new Map()
    this.broken = null
    if (existsSync(this.path)) {
      try {
        if (!lstatSync(this.path).isFile()) throw new Error('not a regular ledger file')
        const bytes = readFileSync(this.path)
        if (bytes.length > CAP || (bytes.length && bytes.at(-1) !== 10)) throw new Error('oversized or truncated ledger')
        for (const line of bytes.toString('utf8').split('\n')) if (line) this.replay(JSON.parse(line))
        this.persistedSize = bytes.length
        this.persistedTail = bytes.subarray(-1024)
      } catch (e) { this.broken = String(e?.message ?? e) }
    }
    // Do not automatically delete abandoned locks: the preceding append may
    // have partially persisted an event. Recovery requires deliberate review.
    if (existsSync(this.lockPath)) this.broken = 'unfinished-ledger-writer'
  }
  apply(event) {
    const p = event.payload
    if (p?.kind === 'observation') {
      if (typeof p.tool !== 'string' || typeof p.failed !== 'boolean' || typeof p.arguments_hash !== 'string' || typeof p.result_hash !== 'string') throw new Error('bad observation')
      this.observations.set(event.digest, { ...p, seq: event.seq })
    } else if (p?.kind === 'unknown-open') {
      if (!this.observations.has(p.source) || this.unknowns.has(p.id) || typeof p.question !== 'string' || !p.question) throw new Error('bad unknown')
      this.unknowns.set(p.id, { ...p, seq: event.seq, resolvedBy: null, resolvedSigned: null, resolvedSeq: 0 })
    } else if (p?.kind === 'unknown-resolve-signed') {
      const u = this.unknowns.get(p.id)
      if (!u || typeof p.proof !== 'string' || !/^[0-9a-f]{64}$/.test(p.proof) ||
        u.resolvedSeq >= event.seq || event.seq <= u.seq) throw new Error('invalid signed unknown resolution')
      u.resolvedBy = p.proof
      u.resolvedSigned = p.proof
      u.resolvedSeq = event.seq
    } else if (p?.kind === 'evidence-link') {
      if (typeof p.source_session_hash !== 'string' || !/^[0-9a-f]{64}$/.test(p.source_session_hash) ||
        typeof p.source_evidence_id !== 'string' || !/^[0-9a-f]{64}$/.test(p.source_evidence_id) ||
        typeof p.source_head !== 'string' || !/^[0-9a-f]{64}$/.test(p.source_head)) {
        throw new Error('invalid external evidence link')
      }
      this.links.set(event.digest, { ...p, seq: event.seq })
    } else if (p?.kind === 'unknown-resolve') {
      const u = this.unknowns.get(p.id), proof = this.observations.get(p.proof)
      if (!u || !proof || proof.failed || proof.seq <= Math.max(u.seq, u.resolvedSeq)) throw new Error('bad resolution')
      u.resolvedBy = p.proof
      u.resolvedSigned = null
      u.resolvedSeq = event.seq
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
    probe.links = new Map(this.links)
    probe.apply(e)
    const bytes = Buffer.from(JSON.stringify(e) + '\n')
    let locked = false
    let durable = false
    try {
      // mkdir is atomic across cooperating local processes. Do not steal a
      // crashed writer's lock and never allow two Session instances to append
      // from the same stale in-memory seq/head.
      mkdirSync(this.lockPath, { mode: 0o700 })
      locked = true
      const fd = openSync(this.path,
        constants.O_CREAT | constants.O_APPEND | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600)
      try {
        const file = fstatSync(fd)
        if (!file.isFile() || file.size !== this.persistedSize) throw new Error('stale-ledger-writer')
        // Constant-size tail comparison also detects same-size edits to the
        // last record; complete hash-chain verification still occurs on load.
        const actual = Buffer.alloc(this.persistedTail.length)
        if (actual.length &&
          readSync(fd, actual, 0, actual.length, file.size - actual.length) !== actual.length) {
          throw new Error('ledger-tail-read-failed')
        }
        if (!actual.equals(this.persistedTail)) throw new Error('stale-ledger-tail')
        if (file.size + bytes.length > CAP) throw new Error('ledger size limit')
        if (writeSync(fd, bytes) !== bytes.length) throw new Error('short ledger write')
        fsyncSync(fd)
        durable = true
      } finally { closeSync(fd) }
    } catch (err) {
      this.broken = String(err?.message ?? err)
      throw err
    } finally {
      // If the append failed or flush was uncertain, leave the lock in place
      // and require explicit recovery, rather than silently trusting a tail.
      if (locked && durable) {
        try { rmdirSync(this.lockPath) }
        catch (err) { this.broken = 'ledger-lock-release-failed'; throw err }
      }
    }
    this.persistedSize += bytes.length
    this.persistedTail = Buffer.concat([this.persistedTail, bytes]).subarray(-1024)
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
  /** Anchor another session's validated evidence by digest, not a copy of tool output.
   * An external link is a historical reference, never a verification credential.
   */
  linkEvidence(sessionId, evidenceId) {
    if (this.broken) throw new Error('trust ledger unavailable')
    if (typeof sessionId !== 'string' || !sessionId || typeof evidenceId !== 'string') throw new TypeError('invalid evidence link')
    const other = new TrustLedger(this.root, sessionId)
    if (other.broken) throw new Error('source ledger integrity failure')
    if (!other.observations.has(evidenceId)) throw new Error('source evidence does not exist')
    const head = other.events.at(-1)?.digest
    if (!head) throw new Error('source ledger empty')
    return this.append({
      kind: 'evidence-link', source_session_hash: sha(sessionId),
      source_evidence_id: evidenceId, source_head: head,
    })
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
    if (!u) throw new Error('unknown missing')
    if (!proof || proof.failed || proof.seq <= Math.max(u.seq, u.resolvedSeq) || !any(policy.verifiers, proof.tool)) throw new Error('later successful verifier evidence required')
    this.append({ kind: 'unknown-resolve', id, proof: proofId })
  }
  /** Signed resolutions remain bound to this exact, still-valid attestation. */
  resolveUnknownSigned(id, verifiedProof) {
    const u = this.unknowns.get(id)
    if (!u) throw new Error('unknown missing')
    if (!verifiedProof || typeof verifiedProof.id !== 'string' ||
      Date.parse(verifiedProof.payload.issued_at) <= Date.parse(this.events[u.seq - 1].time)) {
      throw new Error('a newly issued signed attestation is required')
    }
    this.append({ kind: 'unknown-resolve-signed', id, proof: verifiedProof.id })
  }
  evaluate(tool, policy) {
    if (!any(policy.protected, tool)) return { allowed: true, reason: 'not-protected' }
    if (this.broken) return { allowed: false, reason: 'ledger-corrupt-or-unavailable' }
    if ([...this.unknowns.values()].some(u => !u.resolvedBy)) return { allowed: false, reason: 'open-unknowns' }
    // A policy change may invalidate an old resolution; it must be reverified.
    if ([...this.unknowns.values()].some(u => {
      const proof = this.observations.get(u.resolvedBy)
      return !proof || proof.failed || !any(policy.verifiers, proof.tool)
    })) return { allowed: false, reason: 'unknown-resolution-needs-reverification' }
    // A failing/cancelled mutation may have left side effects. Invalidate
    // prior proofs after ANY mutation attempt, not just successful results.
    const mutationSeq = Math.max(0, ...[...this.observations.values()].filter(v => any(policy.mutations, v.tool)).map(v => v.seq))
    for (const verifier of policy.verifiers) {
      if (![...this.observations.values()].some(v => !v.failed && v.seq > mutationSeq && verifier.test(v.tool))) {
        return { allowed: false, reason: 'missing-or-stale-verification' }
      }
    }
    return { allowed: true, reason: 'verification-evidence-present' }
  }
  status(policy) {
    return { mode: policy.mode, integrity: this.broken ? 'unavailable' : 'ok',
      records: this.events.length, observations: this.observations.size, linked_evidence: this.links.size,
      open_unknowns: [...this.unknowns.values()].filter(u => !u.resolvedBy).map(u => ({ id: u.id, question: u.question, source: u.source })),
      evidence: [...this.observations].slice(-20).map(([id,v]) => ({ id, tool: v.tool, failed: v.failed, seq: v.seq })),
      evidence_links: [...this.links].slice(-20).map(([id,p]) => ({ id, ...p })),
      protected_tools: policy.protectedTools, verifier_tools: policy.verifierTools }
  }
}
