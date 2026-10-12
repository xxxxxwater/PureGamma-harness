import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectSuccessfulRun } from './verify-ci-and-sign.mjs'

const repository = 'xxxxxwater/PureGamma-harness'
const runId = '987654321'
const workflowId = '1234'
const artifactName = 'trusted-release'
const goodRun = {
  id:987654321, repository:{ full_name: repository },
  status:'completed', conclusion:'success', event:'push',
  head_branch:'master', head_sha:'a'.repeat(40), workflow_id:1234,
  name:'Verified Production Build',
}
const artifacts = { artifacts:[{
  name:artifactName, expired:false, workflow_run:{ id:987654321 },
  digest:'sha256:' + 'b'.repeat(64),
}] }
const fakeFetch = (run, list) => async url => ({
  ok:true, json:async () => url.includes('/artifacts') ? list : run,
})
const inputs = {
  repository, runId, workflowId, artifactName, token:'test-token',
  now:Date.parse('2026-10-13T00:00:00Z'),
}
test('CI producer reads immutable GitHub run and artifact digest instead of trusting supplied claims', async () => {
  const proof = await inspectSuccessfulRun({ ...inputs, request:fakeFetch(goodRun, artifacts) })
  assert.deepEqual({
    kind:proof.kind, commit_sha:proof.commit_sha, artifact_sha256:proof.artifact_sha256,
    run_id:proof.run_id, workflow:proof.workflow, conclusion:proof.conclusion,
  }, { kind:'release', commit_sha:'a'.repeat(40), artifact_sha256:'b'.repeat(64),
    run_id:runId, workflow:'Verified Production Build', conclusion:'success' })
  assert.equal(proof.expires_at, '2026-10-13T01:00:00.000Z')
})
test('rejects failed, foreign, mismatched or PR-triggered runs', async () => {
  for (const change of [
    { conclusion:'failure' }, { status:'in_progress' }, { event:'pull_request' },
    { head_branch:'feature' }, { workflow_id:9999 },
    { repository:{ full_name:'attacker/foreign' } },
    { head_sha:'oops' },
  ]) {
    await assert.rejects(() => inspectSuccessfulRun({
      ...inputs, request:fakeFetch({ ...goodRun, ...change }, artifacts),
    }), /not-eligible/)
  }
})
test('rejects missing/expired/ambiguous/unhashed artifacts', async () => {
  for (const list of [
    { artifacts:[] }, { artifacts:[{ ...artifacts.artifacts[0], expired:true }] },
    { artifacts:[{ ...artifacts.artifacts[0], digest:null }] },
    { artifacts:[...artifacts.artifacts, ...artifacts.artifacts] },
    { artifacts:[{ ...artifacts.artifacts[0], workflow_run:{ id:42 } }] },
  ]) {
    await assert.rejects(() => inspectSuccessfulRun({
      ...inputs, request:fakeFetch(goodRun, list),
    }), /artifact/)
  }
})
test('API errors fail closed', async () => {
  await assert.rejects(() => inspectSuccessfulRun({
    ...inputs, request:async () => ({ ok:false, status:403 }),
  }), /github-api-unavailable/)
})
