import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PROVIDER, apply, cliEnvironment, codexStream, conversationPrompt, executable, modelCatalog,
} from './index.js'

const request = () => ({
  provider: PROVIDER,
  model: 'codex-default',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Hello Codex' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'Continue' }] },
  ],
})

async function withFakeCodex(body, scenario) {
  const dir = mkdtempSync(join(tmpdir(), 'pg-codex-fixture-'))
  const binary = join(dir, 'codex')
  writeFileSync(binary, '#!/usr/bin/env node\n' + body + '\n', { mode: 0o700 })
  chmodSync(binary, 0o700)
  try { return await scenario(binary) }
  finally { rmSync(dir, { recursive: true, force: true }) }
}

async function collect(iterable) {
  const all = []
  for await (const c of iterable) all.push(c)
  return all
}

test('model picker registers Codex as a first-class LLM provider', async () => {
  let provider
  let adapter
  apply({ llm: { registerAdapter(names, value) {
    provider = names
    adapter = value
    return () => {}
  } } })
  assert.deepEqual(provider, [PROVIDER])
  assert.equal(adapter.providerInfo(PROVIDER).name, 'OpenAI Codex CLI (ChatGPT login)')
  assert.equal(adapter.providerRetryPolicy(PROVIDER), undefined)
  assert.equal(adapter.imageRequestPricing(PROVIDER, 'codex-default'), undefined)
  assert.deepEqual((await adapter.listModels(PROVIDER)).map(m => m.id), [
    'codex-default', 'gpt-6.1-sol',
  ])
  const call = await adapter.prepareCall(PROVIDER, 'codex-default')
  assert.equal(call.model.provider, PROVIDER)
  assert.equal(typeof call.stream, 'function')
})

test('full conversation projection preserves role order and rejects unsupported content', () => {
  const transcript = JSON.parse(conversationPrompt(request()))
  assert.deepEqual(transcript.history.map(x => x.role), ['user', 'assistant', 'user'])
  assert.deepEqual(transcript.history.map(x => x.blocks[0].text), [
    'Hello Codex', 'Earlier answer', 'Continue',
  ])
  const options = request()
  options.messages[1].content = [{ type: 'image', attachment: { id: 'private' } }]
  assert.throws(() => conversationPrompt(options), /text|images/)
  const large = request()
  large.messages[0].content[0].text = 'X'.repeat(2 * 1024 * 1024)
  assert.throws(() => conversationPrompt(large), /1 MiB/)
})

test('CLI subprocess streams JSONL text and terminates on success', async () => {
  const script = [
    "const fs = require('node:fs')",
    "const prompt = fs.readFileSync(0, 'utf8')",
    "if (!prompt.includes('Hello Codex')) process.exit(7)",
    "console.log(JSON.stringify({type:'item.updated',item:{id:'a',type:'agent_message',text:'Hello'}}))",
    "console.log(JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text:'Hello from CLI'}}))",
    "console.log(JSON.stringify({type:'turn.completed'}))",
  ].join('\n')
  await withFakeCodex(script, async binary => {
    const chunks = await collect(codexStream(request(), { binary }))
    assert.deepEqual(chunks.map(c => c.type), [
      'block-start', 'text-delta', 'text-delta', 'block-end', 'finish',
    ])
    assert.equal(chunks[1].text + chunks[2].text, 'Hello from CLI')
    assert.equal(chunks[3].block.text, 'Hello from CLI')
    assert.deepEqual(chunks.at(-1).reason, { kind: 'stop' })
  })
})

test('failed Codex authentication or model dispatch never becomes a successful answer', async () => {
  const script = "console.log(JSON.stringify({type:'turn.failed'})); process.exit(2)"
  await withFakeCodex(script, async binary => {
    const chunks = await collect(codexStream(request(), { binary }))
    assert.equal(chunks.at(-1).reason.kind, 'error')
    assert.equal(chunks.at(-1).reason.failure.code, 'PROVIDER_ERROR')
  })
  const missingModel = { ...request(), model: 'not-in-catalog' }
  const chunks = await collect(codexStream(missingModel))
  assert.equal(chunks.at(-1).reason.failure.code, 'INVALID_REQUEST')
})

test('CLI abort kills the child and returns an aborted terminal result', async () => {
  await withFakeCodex("setTimeout(() => {}, 60000)", async binary => {
    const signal = new AbortController()
    const call = collect(codexStream({ ...request(), signal: signal.signal }, { binary }))
    setTimeout(() => signal.abort(), 100)
    const chunks = await call
    assert.equal(chunks.at(-1).reason.kind, 'aborted')
  })
})

test('malformed model or CLI path cannot become an executable command', () => {
  assert.throws(() => modelCatalog({ models: ['not allowed; echo hello'] }), /model ids/)
  assert.throws(() => executable({ binary: 'bash' }), /absolute path/)
  assert.throws(() => executable({ binary: '/usr/bin/sh' }), /codex executable/)
  assert.deepEqual(modelCatalog({ models: ['codex-default', 'codex-default'] }), ['codex-default'])
})

test('Codex subprocess never inherits Harness or API secrets', { skip: process.platform === 'win32' }, async () => {
  const saved = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, DSH_WEB_TOKEN: process.env.DSH_WEB_TOKEN }
  process.env.OPENAI_API_KEY = 'private-key'
  process.env.DSH_WEB_TOKEN = 'private-token'
  const script = [
    "require('node:fs').readFileSync(0, 'utf8')",
    "const text = JSON.stringify({ key: process.env.OPENAI_API_KEY ?? null, token: process.env.DSH_WEB_TOKEN ?? null, path: !!process.env.PATH, ci: process.env.CI })",
    "console.log(JSON.stringify({type:'item.completed',item:{id:'a',type:'agent_message',text}}))",
    "console.log(JSON.stringify({type:'turn.completed'}))",
  ].join('\n')
  try {
    await withFakeCodex(script, async binary => {
      const chunks = await collect(codexStream(request(), { binary }))
      const block = chunks.find(c => c.type === 'block-end')
      assert.deepEqual(JSON.parse(block.block.text), { key: null, token: null, path: true, ci: '1' })
    })
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  const windows = cliEnvironment({ Path: 'C:\\bin', SystemRoot: 'C:\\Windows', OPENAI_API_KEY: 'x' }, 'win32')
  assert.equal(windows.PATH, 'C:\\bin')
  assert.equal(windows.SystemRoot, 'C:\\Windows')
  assert.equal(windows.OPENAI_API_KEY, undefined)
})
