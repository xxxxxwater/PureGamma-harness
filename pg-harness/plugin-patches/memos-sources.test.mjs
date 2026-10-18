import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { patchMemosSources } from './bundled-compat.mjs'

const recall = 'function recall(text) { return createUserMessage({ content: [{ type: "text", text }], source: {\n                    kind: "plugin",\n                    plugin: DEEPSEEK_HARNESS_PLUGIN,\n                    form: "recall" } }); }'
const auxiliary = 'function toDshMessage(message, route) { const content = [{ type: "text", text: message.content }]; if (message.role === "user") return createUserMessage({ content, source: { kind: "plugin", plugin: HOST_LLM_MESSAGE_SOURCE } }); return createAssistantMessage({ content, source: { provider: route.provider, model: route.model } }); }'

test('MemOS recall messages use the same producer identity as migrated v3 history', () => {
  const context = { createUserMessage: value => value, DEEPSEEK_HARNESS_PLUGIN: 'memos-local-memory' }
  const before = runInNewContext(recall + ';recall("context")', context)
  assert.equal(before.source.kind, 'plugin')
  const fixed = patchMemosSources(recall)
  const after = runInNewContext(fixed + ';recall("context")', context)
  assert.equal(after.source.kind, 'plugin:memos-local-memory')
  assert.equal(after.source.form, 'recall')
  assert.equal(after.content[0].text, 'context')
  assert.equal(patchMemosSources(fixed), fixed)
})

test('MemOS auxiliary LLM messages identify both the plugin and the routed model', () => {
  const fixed = patchMemosSources(auxiliary)
  const ctx = { createUserMessage: value => value, createAssistantMessage: value => value, HOST_LLM_MESSAGE_SOURCE: 'memos-host-llm' }
  const source = role => runInNewContext(fixed + `;toDshMessage({role:"${role}",content:"text"},{provider:"codex-cli",model:"test"})`, ctx).source
  assert.equal(source('user').kind, 'plugin:memos-host-llm')
  assert.equal(source('assistant').kind, 'model')
  assert.equal(source('assistant').provider, 'codex-cli')
  assert.equal(source('assistant').model, 'test')
  assert.equal(patchMemosSources(fixed), fixed)
  assert.throws(() => patchMemosSources('different upstream code'), /expected exactly one/)
})
