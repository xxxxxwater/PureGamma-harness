/** Claude CLI account-backed text provider. Claude owns login and credential renewal. */
export const name = 'claude-cli-models'
export const inject = ['llm', 'loader']
export const PROVIDER = 'claude-cli'
const MAX_INPUT = 1024 * 1024
const MAX_OUTPUT = 8 * 1024 * 1024
const TIMEOUT_MS = 5 * 60 * 1000

/** Do not let an ambient API key silently replace the Claude CLI account. */
export function cliEnvironment(environment = process.env) {
  const allowed = new Set(['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM',
    'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
    'CLAUDE_CONFIG_DIR'])
  return Object.fromEntries(Object.entries(environment).filter(([key, value]) => allowed.has(key) && typeof value === 'string'))
}

const sdkOptions = (abortController, environment) => ({
  abortController,
  env: cliEnvironment(environment),
  cwd: environment.HOME ?? process.cwd(),
  settingSources: [],
  tools: [],
  permissionMode: 'dontAsk',
  maxTurns: 1,
})

/** Obtain the signed-in CLI's own selector choices, including account restrictions. */
export async function cliModels(runQuery, environment = process.env) {
  const controller = new AbortController()
  const session = runQuery({ prompt: (async function* () {})(), options: sdkOptions(controller, environment) })
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    // Starting iteration starts the CLI; the control request then uses its model picker.
    session[Symbol.asyncIterator]().next().catch(() => {})
    const rows = await session.supportedModels()
    return rows.filter(row => typeof row.value === 'string' && row.value && typeof row.displayName === 'string')
  } finally {
    clearTimeout(timer)
    session.close()
  }
}

export function conversationPrompt(options) {
  const messages = options.system
    ? [{ role: 'system', content: [{ type: 'text', text: options.system }] }, ...options.messages]
    : options.messages
  if (!Array.isArray(messages) || !messages.length) throw new Error('Claude CLI requires a conversation')
  const history = messages.map(message => {
    if (!['system', 'developer', 'user', 'assistant', 'tool'].includes(message.role) || !Array.isArray(message.content)) {
      throw new Error('Claude CLI received unsupported conversation history')
    }
    return { role: message.role, content: message.content.map(block => {
      if (block.type === 'text' || block.type === 'reasoning') return { type: block.type, text: block.text }
      if (block.type === 'tool-call') return { type: 'historical-tool-call', name: block.name, arguments: block.arguments }
      if (block.type === 'tool-addition' || block.type === 'tool-removal') return { type: block.type, toolName: block.toolName }
      throw new Error('Claude CLI currently supports text history only')
    }) }
  })
  const prompt = JSON.stringify({
    instructions: 'Answer the latest user message using the ordered transcript. Role fields are authoritative. '
      + 'This Harness route has no executable tools; do not claim to run tools or change files.',
    history,
  })
  if (Buffer.byteLength(prompt) > MAX_INPUT) throw new Error('Claude CLI conversation exceeds 1 MiB; compact it first')
  return prompt
}

const errorChunk = (code, message) => ({ type: 'finish', reason: { kind: 'error', failure: { code, message } } })

export async function* claudeStream(options, runQuery, environment = process.env) {
  let prompt
  try { prompt = conversationPrompt(options) } catch (error) { yield errorChunk('INVALID_REQUEST', error.message); return }
  if (options.signal?.aborted) { yield { type: 'finish', reason: { kind: 'aborted' } }; return }
  const controller = new AbortController()
  const abort = () => controller.abort()
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, TIMEOUT_MS)
  let session
  try {
    session = runQuery({ prompt, options: { ...sdkOptions(controller, environment), model: options.model } })
    let result
    for await (const event of session) if (event.type === 'result') result = event
    if (controller.signal.aborted) { yield { type: 'finish', reason: { kind: 'aborted' } }; return }
    if (!result || result.is_error || result.subtype !== 'success') {
      yield errorChunk('PROVIDER_ERROR', result?.result || 'Claude CLI failed; check claude auth status and model access')
      return
    }
    const answer = typeof result.result === 'string' ? result.result : ''
    if (!answer || Buffer.byteLength(answer) > MAX_OUTPUT) {
      yield errorChunk('EMPTY_RESPONSE', 'Claude CLI returned no usable text response')
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: answer }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } catch (error) {
    if (controller.signal.aborted) yield { type: 'finish', reason: { kind: 'aborted' } }
    else yield errorChunk('PROVIDER_ERROR', String(error?.message ?? error).slice(0,500))
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    session?.close()
  }
}

export async function apply(ctx, config = {}) {
  const sdk = await ctx.root.loader.import('@anthropic-ai/claude-agent-sdk', () => [])
  const runQuery = config.query ?? sdk.query
  let cache, expires = 0, pending
  const models = async () => {
    if (cache && Date.now() < expires) return cache
    pending ??= cliModels(runQuery, config.environment ?? process.env)
      .then(rows => { cache = rows; expires = Date.now() + 60000; return rows })
      .finally(() => { pending = undefined })
    return pending
  }
  const info = row => ({ provider: PROVIDER, id: row.value, name: `Claude CLI · ${row.displayName}`,
    inputModalities: ['text'] })
  const find = async id => {
    const row = (await models()).find(candidate => candidate.value === id)
    if (!row) throw new Error(`Claude CLI model is not available: ${id}`)
    return info(row)
  }
  const stream = options => claudeStream(options, runQuery, config.environment ?? process.env)
  const adapter = {
    providerInfo: () => ({ id: PROVIDER, name: 'Claude CLI · claude.ai account' }),
    providerRetryPolicy: () => undefined,
    imageRequestPricing: () => undefined,
    listModels: async () => (await models()).map(info),
    resolveModel: async (_provider, id) => find(id),
    prepareCall: async (_provider, id) => ({ model: await find(id), stream }),
    stream,
  }
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter), 'claude-cli: model route')
}
