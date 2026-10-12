/**
 * CI/risk-gateway side ONLY. Not a Harness tool. The caller MUST independently
 * verify CI success/artifact provenance or risk constraints before signing.
 *
 * node sign-attestation.mjs payload.json private-key.pem output.json key-id
 */
import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { signedBytes } from './attestations.mjs'

export function signEnvelope(payload, pem, keyId) {
  if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(keyId)) throw new TypeError('invalid signer id')
  const key = createPrivateKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('Ed25519 signer key required')
  if (!['release','trade'].includes(payload?.kind)) throw new TypeError('invalid signed payload kind')
  return {
    schema: 'pg.trust.attestation.v1', key_id: keyId, payload,
    signature: sign(null, signedBytes(payload), key).toString('base64'),
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const [payloadFile, keyFile, outputFile, keyId] = process.argv.slice(2)
  if (!payloadFile || !keyFile || !outputFile || !keyId) {
    console.error('Usage: node sign-attestation.mjs payload.json private-key.pem output.json key-id')
    process.exitCode = 2
  } else {
    const payload = JSON.parse(readFileSync(payloadFile, 'utf8'))
    const envelope = signEnvelope(payload, readFileSync(keyFile, 'utf8'), keyId)
    writeFileSync(outputFile, JSON.stringify(envelope, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    console.log('Created signed attestation at ' + outputFile)
  }
}
