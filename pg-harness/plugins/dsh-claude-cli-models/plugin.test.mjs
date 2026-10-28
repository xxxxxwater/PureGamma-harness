import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply, claudeStream, cliEnvironment, cliModels, conversationPrompt } from './index.js'

test('Claude account subprocess does not inherit API keys or Harness secrets', () => {
  assert.deepEqual(cliEnvironment({ HOME: '/tmp/home', PATH: '/bin', ANTHROPIC_API_KEY: 'private',
    CLAUDE_CODE_OAUTH_TOKEN: 'private', DSH_WEB_TOKEN: 'private', HTTPS_PROXY: 'http://proxy' }),
  { HOME: '/tmp/home', PATH: '/bin', HTTPS_PROXY: 'http://proxy' })
})

test('Windows Claude subprocess keeps the runtime variables the CLI needs', () => {
  assert.deepEqual(cliEnvironment({ Path: 'C:\\bin', USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\A', LOCALAPPDATA: 'C:\\L',
    SystemRoot: 'C:\\Windows', PATHEXT: '.EXE;.CMD', ComSpec: 'cmd.exe', TEMP: 'C:\\T', TMP: 'C:\\T', ANTHROPIC_API_KEY: 'private' }, 'win32'),
  { PATH: 'C:\\bin', USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\A', LOCALAPPDATA: 'C:\\L', SystemRoot: 'C:\\Windows',
    PATHEXT: '.EXE;.CMD', ComSpec: 'cmd.exe', TEMP: 'C:\\T', TMP: 'C:\\T' })
  assert.equal(cliEnvironment({ USERPROFILE: 'C:\\Users\\me' }, 'linux').USERPROFILE, undefined)
})

test('reads all CLI model picker rows without inference', async () => {
  let prompt, closed = false
  const rows = [{ value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus' },
    { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku' }]
  const runQuery = input => {
    prompt = input.prompt
    return { [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }),
      supportedModels: async () => rows, close: () => { closed = true } }
  }
  assert.deepEqual(await cliModels(runQuery, { HOME: '/tmp' }), rows)
  assert.equal(typeof prompt[Symbol.asyncIterator], 'function')
  assert.equal(closed, true)
})

test('keeps transcript roles while rejecting unsupported image blocks', () => {
  const prompt = conversationPrompt({ system: 'Be concise', messages: [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
  ] })
  assert.deepEqual(JSON.parse(prompt).history.map(x => x.role), ['system', 'user', 'assistant'])
  assert.throws(() => conversationPrompt({ messages: [{ role: 'user', content: [{ type: 'image' }] }] }), /text history/)
})

test('streams completed CLI text and surfaces an expired login as an error', async () => {
  const options = { model: 'opus', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }
  const run = result => () => ({
    async *[Symbol.asyncIterator]() { yield result }, close() {},
  })
  const good = []
  for await (const event of claudeStream(options, run({ type: 'result', subtype: 'success', is_error: false, result: 'OK' }), { HOME: '/tmp' })) good.push(event)
  assert.deepEqual(good.map(x => x.type), ['block-start', 'text-delta', 'block-end', 'finish'])
  assert.equal(good[1].text, 'OK')
  assert.equal(good.at(-1).reason.kind, 'stop')
  const failed = []
  for await (const event of claudeStream(options, run({ type: 'result', subtype: 'success', is_error: true,
    result: 'OAuth session expired' }), { HOME: '/tmp' })) failed.push(event)
  assert.equal(failed[0].reason.kind, 'error')
  assert.match(failed[0].reason.failure.message, /expired/)
})

test('registers the account model route and exposes every CLI picker choice', async () => {
  let route, adapter
  const rows = [
    { value: 'default', displayName: 'Default' },
    { value: 'opus', displayName: 'Opus' },
    { value: 'fable', displayName: 'Fable' },
    { value: 'sonnet', displayName: 'Sonnet' },
    { value: 'haiku', displayName: 'Haiku' },
  ]
  const runQuery = () => ({
    [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }),
    supportedModels: async () => rows, close() {},
  })
  const ctx = {
    root: { loader: { import: async () => ({ query: runQuery }) } },
    llm: { registerAdapter: (providers, value) => { route = providers; adapter = value; return () => {} } },
    effect: callback => callback(),
  }
  await apply(ctx, { environment: { HOME: '/tmp' } })
  assert.deepEqual(route, ['claude-cli'])
  assert.deepEqual((await adapter.listModels()).map(x => x.id), rows.map(x => x.value))
  assert.equal((await adapter.resolveModel('claude-cli', 'opus')).name, 'Claude CLI · Opus')
})
