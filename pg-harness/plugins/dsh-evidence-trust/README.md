# PureGamma Evidence Trust v0.2.0

Cordis plugin for session-local Evidence Ledger, Unknown Registry, and **signed, target-bound Verification Gate**. See [implementation](index.js), [signature verifier](attestations.mjs) and [CI producer](verify-ci-and-sign.mjs).

## Compatibility and secure defaults

The PureGamma desktop installer mounts this plugin in AUDIT mode: no tool is blocked. The hash-chained per-session ledger stores final tool name, result state, digests and call sequence. Raw arguments and outputs are not stored. Unknown questions are persisted verbatim: never put secrets in their text.

V2 ENFORCE mode **requires trusted Ed25519 public keys and explicit signed release/trading rules**. Legacy policies relying on a normal verifier tool returning success NO LONGER authorize protected execution. Any unclassified name appearing in protectedTools is denied. After updating the plugin, review your existing profile override before restarting.

### Release proof

The exact repository, 40-hex commit SHA, 64-hex build artifact SHA-256, decimal CI run ID, pinned workflow, success conclusion, issuance/expiry and signer identity are included in the signed payload. The tool's own arguments must match ALL these fields.

The GitHub Actions proof producer verifies GitHub's run status, event=push, branch=master, workflow ID, head commit, and exactly one CI artifact with a GitHub-provided sha256 digest. The digest binds the **Actions artifact archive**, not each executable extracted from it. Separate signed per-file manifests are required if your deployment pipeline uses extracted assets.

Signatures are Ed25519 over the bytes: "PureGamma.Trust.Attestation.v1\n" followed by canonical JSON of the payload. Public keys are explicitly pinned and scoped to release/trade kinds. SHA hashes or successful tool outputs alone are not authorizations.

### Trading proof

A signed trade claim binds a SHA-256 hash of the EXACT order arguments: venue, account, symbol, side, quantity, price, notional_usd, leverage, reduce_only, client_order_id. It also binds venue, account, symbol, notional, leverage, an allow decision, expiry, and trusted signer.

Gate checks configured account/venue allowlists, max notional and leverage. Lifetime is at most 300 seconds; <=120 seconds is recommended. One proof can authorize only one order digest, once, across sessions on the SAME HOST: the .spent reservation is atomic and is not refunded on an execution failure. A newly signed envelope cannot bypass a spent order digest.

IMPORTANT: The external risk signer MUST independently verify account balances, leverage availability, mark price, liquidation buffer, contract multiplier, and trading permissions. This plugin does not connect to the exchange or perform position reconciliation. Do not enable this against live trading without first proving the external risk service and order adapter in paper/fault-injection tests. On multi-host installations use a centralized atomic reservation service instead.

### Cross-session evidence and unknowns

pg_trust_link_evidence imports NO raw output. It checks the source session's hash chain and links its exact evidence ID and source ledger-head digest into the current session. Such links are historical references, NOT signed authorizations. Signed proof files are stored in a host-local shared vault; any session may reuse a release proof only while all target claims still match.

In ENFORCE, closing an unknown requires a **newly issued signed attestation** and the gate requires all resolved unknowns to reference the EXACT matching proof. Legacy verifier successes may close unknowns only in AUDIT, never in ENFORCE.

## Configuration examples

Install with the PureGamma installer. The bundled patch remains Audit by default. The following example is a replacement *complete* profile patch row. Replace placeholder key/tool identifiers with actual values; use a fresh offline-generated Ed25519 keypair, pin only the PUBLIC PEM here, and never publish the private PEM:

~~~yaml
- patch:
    id: evidence-trust
    config:
      mode: enforce
      protectedTools: []
      verifierTools: []
      mutationTools: []
      attestations:
        trustedKeys:
          - id: release-2026-10
            kinds: [release]
            publicKeyPem: |
              -----BEGIN PUBLIC KEY-----
              REPLACE_WITH_GENERATED_PUBLIC_KEY
              -----END PUBLIC KEY-----
        release:
          tools: [publish_release]
          repository: xxxxxwater/PureGamma-harness
          workflow: Verified Production Build
          maxAgeSeconds: 1800
          paths:
            repository: repository
            commit_sha: commit_sha
            artifact_sha256: artifact_sha256
            run_id: run_id
~~~

Separate paper-trading example (merge under the SAME attestations object for both rules):

~~~yaml
attestations:
  trustedKeys:
    - id: risk-gateway-v1
      kinds: [trade]
      publicKeyPem: "<public Ed25519 PEM>"
  trade:
    tools: [trade_place]
    allowedVenues: [binance-pm]
    allowedAccounts: [paper-1]
    maxNotionalUsd: 1000
    maxLeverage: 2
    maxAgeSeconds: 90
    paths:
      venue: venue
      account: account
      symbol: symbol
      side: side
      quantity: quantity
      price: price
      notional_usd: notional_usd
      leverage: leverage
      reduce_only: reduce_only
      client_order_id: client_order_id
~~~

Strict paths must match the real tool argument schema, not these example names. Unprotected aliases, generic shell tools and direct broker APIs remain outside this name-based guard and must be sandboxed or explicitly protected. An enforce policy with only legacy tool-success verifiers fails at plugin startup.

## CI signing procedure

1. Create an Ed25519 signing key pair offline. Pin only the PUBLIC PEM in a local Harness profile. Never copy the private key into a chat session.
2. Create GitHub environment puregamma-trust-signing, configure required reviewers, store PG_TRUST_CI_PRIVATE_KEY_PEM as an environment secret, and define PG_TRUST_CI_WORKFLOW_ID and PG_TRUST_CI_KEY_ID as environment variables (only allow trusted CI workflow IDs).
3. A successful, trusted master PUSH workflow must have uploaded an Actions artifact with a GitHub sha256 digest. Manually dispatch .github/workflows/puregamma-trust-attest.yml with its run ID and exact artifact name. The signer verifies GitHub metadata before generating a signed envelope.
4. Download the puregamma-signed-attestation artifact and send its JSON envelope to pg_trust_import_attestation.
5. Preview the gate with pg_trust_check_gate and supply the ACTUAL publishing tool name and complete arguments. It cannot grant execution on its own.

The standalone sign-attestation.mjs is a key-using primitive for offline, independently vetted risk-gateway processes. It does not confirm CI truth or account safety; never sign a payload authored only by an Agent.

## Agent-facing tools

| Tool | Function |
| --- | --- |
| pg_trust_status | Current session evidence, links, signed-proof count and mode |
| pg_trust_open_unknown | Record question backed by a local evidence ID |
| pg_trust_resolve_unknown | Audit: legacy verification_evidence_id; enforce: signed attestation_id |
| pg_trust_import_attestation | Verify Ed25519 signature, scope and expiry; persist signed envelope |
| pg_trust_link_evidence | Link exact historical evidence from another session |
| pg_trust_check_gate | Read-only preflight using target_tool AND target_arguments |

Ledger: $DSH_HOME/pg-trust-ledgers/<sha256(session-id)>.jsonl. Signed envelopes: $DSH_HOME/pg-trust-ledgers/attestations-v1/*.json. Spent markers there as well. The ledger detects edits but cannot prevent a privileged local attacker rewriting all records. The shared vault is host-local; production multi-host requires a centralized transactional authority.

## Tests and rollout

~~~sh
node --test pg-harness/plugins/dsh-evidence-trust/*.test.mjs pg-harness/install.test.mjs
~~~

CI also runs Node syntax checks and plugin compatibility tests. These tests establish the plugin behavior, not the correctness of an external signing authority, release pipeline or live trading adapter.

**No production deployment, exchange order, GUI installation or desktop release occurs from these commits.** Re-run the updated PureGamma installer locally and restart Harness. Existing V1 ledger records remain readable. Test audit/paper environments before enabling enforce.
