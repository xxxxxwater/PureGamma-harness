/** Play a local macOS chime for successful top-level conversation turns. */
import { execFile } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const name = 'task-completion-chime'
export const inject = ['sessions']
export const soundPath = fileURLToPath(new URL('./ding-dong.wav', import.meta.url))

/** Own native sound processes and wait for them when the plugin is unloaded. */
export function createChimePlayer({ volume = 0.7, playbackTimeoutMs = 5000 } = {}) {
  if (process.platform !== 'darwin') throw new Error('任务完成提示音插件需要 macOS。')
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new TypeError('任务完成提示音的 volume 必须在 0 到 1 之间。')
  }
  if (!Number.isSafeInteger(playbackTimeoutMs) || playbackTimeoutMs <= 0) {
    throw new TypeError('playbackTimeoutMs 必须为正整数。')
  }
  accessSync(soundPath, constants.R_OK)
  const active = new Map()
  let disposed = false
  return {
    play() {
      if (disposed) return Promise.resolve()
      let child
      const done = new Promise((resolve, reject) => {
        child = execFile('/usr/bin/afplay', ['-v', String(volume), soundPath], {
          timeout: playbackTimeoutMs,
          windowsHide: true,
          env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
        }, error => {
          active.delete(child)
          if (error && !disposed) reject(error)
          else resolve()
        })
      })
      active.set(child, done)
      return done
    },
    async dispose() {
      disposed = true
      const pending = [...active.entries()]
      for (const [child] of pending) child.kill()
      await Promise.allSettled(pending.map(([, done]) => done))
    },
  }
}

/** Subscribe only to newly appended successful turns; restoring history stays silent. */
export function apply(ctx, config = {}) {
  const player = createChimePlayer(config)
  const completedTurns = new WeakMap()
  let active = true
  ctx.effect(() => async () => {
    active = false
    await player.dispose()
  }, 'task-completion-chime: audio processes')
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end' || event.data.reason.kind !== 'completed') return
    if (session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0) return
    if (event.seq < session.firstLiveSeq) return
    if ((completedTurns.get(session) ?? 0) >= event.data.turn) return
    completedTurns.set(session, event.data.turn)
    void player.play().then(() => {
      if (active) ctx.logger.info('叮咚：会话 %s 的第 %s 轮任务已完成。', session.id, event.data.turn)
    }).catch(error => {
      if (active) ctx.logger.warn('任务完成提示音播放失败：%s', error.message)
    })
  }, { global: true })
  ctx.logger.info('任务完成提示音已启用。')
}
