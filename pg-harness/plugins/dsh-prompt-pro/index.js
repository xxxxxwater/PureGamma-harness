import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export const name = 'prompt-pro'
export const inject = ['webServer', 'connection']

const MAX_DRAFT = 12000
const MAX_RESULT = 32000
const TIMEOUT_MS = 120000

export function instruction(draft) {
  return `你是专业的提示词编辑。只把 <原始请求> 改写成一条可直接提交给 AI 助手的请求，不执行请求本身。\n\n要求：\n1. 保留原始目标、语言、专有名词、路径、数值、禁止事项和授权边界。\n2. 让任务更明确、信息更完整、表达更专业；按需补充目标、背景、实施步骤、交付物和验收标准。简单任务保持简洁，复杂任务用清晰段落或列表。\n3. 不编造用户没有提供的事实、权限、数据、时间或完成状态。缺少的关键信息用简短占位或请执行者先核实。\n4. 如涉及代码或实际操作，强调检查现状、最小必要改动、验证结果和报告限制；不要扩展任务范围。\n5. 不加入自我评价、前言、解释或 Markdown 代码围栏。只输出改写后的提示词。\n\n<原始请求>\n${draft}\n</原始请求>`
}

export function findCodex(environment = process.env) {
  const candidates = [environment.PG_PROMPT_PRO_CODEX_PATH, '/usr/local/bin/codex', '/opt/homebrew/bin/codex', join(homedir(), '.local/bin/codex')]
  for (const path of (environment.PATH || '').split(':')) candidates.push(join(path, 'codex'))
  return candidates.find(path => path && existsSync(path))
}

export function runCodex(draft, { cliPath = findCodex(), signal, timeoutMs = TIMEOUT_MS } = {}) {
  if (!cliPath) return Promise.reject(new Error('找不到本机 Codex CLI'))
  const directory = mkdtempSync(join(tmpdir(), 'pg-prompt-pro-'))
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, ['exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', directory, '-m', 'gpt-6.1-sol', '-c', 'model_reasoning_effort="medium"', '--color', 'never', '-'], {
      cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' },
    })
    let output = '', diagnostic = '', settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      rmSync(directory, { recursive: true, force: true })
      if (error) reject(error)
      else resolve(result)
    }
    const abort = () => child.kill('SIGTERM')
    const timer = setTimeout(() => { child.kill('SIGTERM'); finish(new Error('提示词增强超时，请稍后重试')) }, timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { output += chunk; if (output.length > MAX_RESULT) child.kill('SIGTERM') })
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-2000) })
    child.stdin.on('error', () => {})
    child.on('error', error => finish(error))
    child.on('close', code => {
      if (signal?.aborted) return finish(new Error('增强已取消'))
      const result = output.trim()
      if (code !== 0) return finish(new Error(diagnostic.trim().split('\n').at(-1) || `Codex CLI 退出代码 ${code}`))
      if (!result || result.length > MAX_RESULT) return finish(new Error('增强结果为空或过长'))
      finish(null, result)
    })
    child.stdin.end(instruction(draft))
  })
}

export function apply(ctx) {
  const active = new Set()
  const send = (res, status, value) => {
    if (res.writableEnded || res.destroyed) return
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/pg-prompt-pro/api', handler: async (req, res) => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection !== undefined) return send(res, rejection, { error: 'unauthorized' })
    if (new URL(req.url ?? '/', 'http://local').pathname !== '/pg-prompt-pro/api/enhance') return send(res, 404, { error: 'not found' })
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
    if (active.size >= 2) return send(res, 429, { error: '已有两项增强正在运行，请稍后重试' })
    let raw = ''
    try {
      for await (const chunk of req) {
        raw += chunk
        if (raw.length > MAX_DRAFT * 4) return send(res, 413, { error: '输入过长' })
      }
      const draft = JSON.parse(raw).draft
      if (typeof draft !== 'string' || !draft.trim() || draft.length > MAX_DRAFT) return send(res, 400, { error: '请输入 1–12000 字的草稿' })
      const controller = new AbortController()
      active.add(controller)
      res.once('close', () => controller.abort())
      try { send(res, 200, { text: await runCodex(draft.trim(), { signal: controller.signal }) }) }
      finally { active.delete(controller) }
    } catch (error) {
      send(res, 500, { error: error.message || '提示词增强失败' })
    }
  } }), 'prompt-pro: authenticated enhance endpoint')
  ctx.effect(() => () => { for (const controller of active) controller.abort() }, 'prompt-pro: cancel active calls')
}
