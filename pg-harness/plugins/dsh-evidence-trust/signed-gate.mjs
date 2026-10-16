/** Fail-closed high-assurance release and trading guards. */
import { digest } from './ledger.mjs'
import { releaseTarget, tradeTarget } from './attestations.mjs'

const match = (patterns, name) => patterns.some(p => p.test(name))

export class SignedGate {
  constructor(legacyPolicy, attestations, vault) {
    this.policy = legacyPolicy
    this.config = attestations
    this.vault = vault
  }
  protects(name) {
    return match(this.policy.protected, name) ||
      match(this.config.release?.tools ?? [], name) ||
      match(this.config.trade?.tools ?? [], name)
  }
  /**
   * Preview does not consume a trade intent. Dispatch checks and reserves
   * exactly once through tools.guard() before the protected body begins.
   */
  decide(exec, ledger, reserve = false, now = Date.now()) {
    if (!this.protects(exec.name)) return { allowed: true, reason: 'not-protected' }
    if (ledger.broken) return { allowed: false, reason: 'ledger-corrupt-or-unavailable' }
    const release = this.config.release && match(this.config.release.tools, exec.name)
    const trade = this.config.trade && match(this.config.trade.tools, exec.name)
    if ((release && trade) || (!release && !trade)) {
      return { allowed: false, reason: 'unclassified-or-ambiguous-protected-tool' }
    }
    let target
    try {
      target = release
        ? releaseTarget(exec.arguments, this.config.release)
        : tradeTarget(exec.arguments, this.config.trade)
    } catch (error) {
      return { allowed: false, reason: String(error?.message ?? 'missing-or-invalid-binding') }
    }
    let auth
    try {
      auth = this.vault.authorize(release ? 'release' : 'trade', target,
        release ? this.config.release.maxAgeSeconds : this.config.trade.maxAgeSeconds, now)
    } catch {
      return { allowed: false, reason: 'attestation-store-unavailable' }
    }
    if (!auth.allowed) return auth
    // Legacy tool-success unknown resolutions are not sufficient for the
    // signed gate. Every question must name the SAME valid, scoped proof.
    if ([...ledger.unknowns.values()].some(u => !u.resolvedSigned || u.resolvedSigned !== auth.proof_id)) {
      return { allowed: false, reason: 'open-or-stale-signed-unknowns' }
    }
    if (trade && reserve) {
      // Atomic, host-global per-intent reservation. A retry, a second signature
      // for the same order, and another session cannot spend it again.
      try { this.vault.reserveTrade(digest(target)) }
      catch { return { allowed: false, reason: 'trade-intent-already-spent-or-unavailable' } }
    }
    // Commit a receipt before the protected body. A failed ledger append must
    // block execution; the trade reservation deliberately remains spent.
    if (reserve) {
      try {
        ledger.recordGrant(exec.name, trade ? 'trade' : 'release', auth.proof_id, target)
      } catch {
        return { allowed: false, reason: 'authorization-receipt-unavailable' }
      }
    }
    return { allowed: true, reason: trade ? 'signed-risk-authorization' : 'signed-ci-authorization',
      kind: trade ? 'trade' : 'release', proof_id: auth.proof_id }
  }
}
