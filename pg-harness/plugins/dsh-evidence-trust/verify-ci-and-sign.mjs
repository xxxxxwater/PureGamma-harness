/**
 * Trusted GitHub Actions attestation producer (CI runner only).
 * Validates GitHub run status, workflow identity and artifact archive digest
 * BEFORE signing. Requires GITHUB_TOKEN actions:read and protected CI signer key.
 * Never accepts a claimed result supplied by a model or a shell command.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { signEnvelope } from './sign-attestation.mjs'

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const HEX = /^[a-f0-9]{64}$/
const COMMIT = /^[a-f0-9]{40}$/
const RUN = /^[1-9][0-9]{0,19}$/

export async function inspectSuccessfulRun({
  repository, runId, artifactName, workflowId, token, request = fetch, now = Date.now(),
}) {
  if (!REPO.test(repository) || !RUN.test(String(runId)) || !Number.isSafeInteger(Number(workflowId)) ||
    Number(workflowId) <= 0 || typeof artifactName !== 'string' || !artifactName ||
    !/^[A-Za-z0-9_.-]{1,120}$/.test(artifactName)) throw new Error('invalid-ci-inputs')
  if (typeof token !== 'string' || !token) throw new Error('github-token-required')
  const read = async path => {
    const url = 'https://api.github.com/repos/' + repository + path
    const response = await request(url, { headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }, redirect: 'error', signal: AbortSignal.timeout(20000) })
    if (!response.ok) throw new Error('github-api-unavailable-' + response.status)
    return response.json()
  }
  const run = await read('/actions/runs/' + String(runId))
  if (String(run.id) !== String(runId) || run.repository?.full_name !== repository ||
    run.status !== 'completed' || run.conclusion !== 'success' ||
    run.event !== 'push' || run.head_branch !== 'master' ||
    Number(run.workflow_id) !== Number(workflowId) || !COMMIT.test(run.head_sha)) {
    throw new Error('ci-run-not-eligible')
  }
  const artifacts = await read('/actions/runs/' + String(runId) + '/artifacts?per_page=100')
  if (!Array.isArray(artifacts.artifacts)) throw new Error('invalid-artifact-list')
  const matching = artifacts.artifacts.filter(a => a.name === artifactName)
  if (matching.length !== 1 || matching[0].expired ||
    String(matching[0].workflow_run?.id ?? run.id) !== String(runId) ||
    !/^sha256:[a-f0-9]{64}$/.test(matching[0].digest ?? '')) {
    throw new Error('missing-ambiguous-or-unhashed-ci-artifact')
  }
  const artifactSha = matching[0].digest.slice(7)
  if (!HEX.test(artifactSha) || typeof run.name !== 'string' || !run.name) throw new Error('invalid-ci-attestation-fields')
  return {
    kind: 'release', repository, commit_sha: run.head_sha,
    artifact_sha256: artifactSha, run_id: String(runId), workflow: run.name,
    conclusion: 'success', issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
  }
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('CI attestation signer may only run in GitHub Actions')
  const env = process.env
  const keyFile = env.PG_TRUST_CI_KEY_FILE
  const output = env.PG_TRUST_PROOF_OUTPUT
  if (!keyFile || !output) throw new Error('missing-ci-signer-paths')
  const payload = await inspectSuccessfulRun({
    repository: env.GITHUB_REPOSITORY, runId: env.PG_TRUST_CI_RUN_ID,
    artifactName: env.PG_TRUST_CI_ARTIFACT_NAME, workflowId: env.PG_TRUST_CI_WORKFLOW_ID,
    token: env.GITHUB_TOKEN,
  })
  const envelope = signEnvelope(payload, readFileSync(keyFile, 'utf8'), env.PG_TRUST_CI_KEY_ID)
  writeFileSync(output, JSON.stringify(envelope, null, 2) + '\n', { flag:'wx', mode:0o600 })
  console.log('Signed verified CI run ' + payload.run_id + ' and artifact archive sha256 ' + payload.artifact_sha256)
}
