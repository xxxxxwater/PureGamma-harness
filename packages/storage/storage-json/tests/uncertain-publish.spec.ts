import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { JsonStorageBackend } from '../src/index.ts'

const faults = vi.hoisted(() => ({
  syncDirectory: undefined as string | undefined,
  renameTarget: undefined as string | undefined,
  failure: Object.assign(new Error('injected filesystem failure'), { code: 'EIO' }),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      if (args[1] === 'r' && args[0] === faults.syncDirectory) {
        handle.sync = () => Promise.reject(faults.failure)
      }
      return handle
    },
    rename: (...args: Parameters<typeof fs.rename>) => {
      if (args[1] === faults.renameTarget) return Promise.reject(faults.failure)
      return fs.rename(...args)
    },
  }
})

afterEach(() => {
  faults.syncDirectory = undefined
  faults.renameTarget = undefined
})

const descriptor = { name: 'uncertain', version: 1, tables: ['t'], hasGlobal: true }

it.each(['single', 'per-record'] as const)('keeps the %s layout usable when the rename fails before publishing', async (layout) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-json-before-rename-'))
  const backend = new JsonStorageBackend(root)
  onTestFinished(async () => {
    await backend.close()
    await rm(root, { recursive: true, force: true })
  })
  const unit = await backend.kv.open({ ...descriptor, layout })
  const path = layout === 'single' ? join(root, 'uncertain.json') : join(root, 'uncertain', 't', 'a.json')
  await unit.putRecord('t', 'a', { value: 'before' })
  const before = await readFile(path, 'utf8')

  faults.renameTarget = path
  await expect(unit.putRecord('t', 'a', { value: 'after' })).rejects.toBe(faults.failure)
  expect(await readFile(path, 'utf8')).toBe(before)
  expect((await unit.loadAll()).tables['t']).toEqual({ a: { value: 'before' } })

  faults.renameTarget = undefined
  await unit.putRecord('t', 'a', { value: 'retry' })
  expect((await unit.loadAll()).tables['t']).toEqual({ a: { value: 'retry' } })
  expect(await readFile(path, 'utf8')).toContain('"retry"')
})

it.skipIf(process.platform === 'win32').each([
  ['single', 'record'],
  ['single', 'global'],
  ['single', 'delete'],
  ['per-record', 'record'],
  ['per-record', 'global'],
] as const)('quarantines the %s layout after a published %s change cannot sync', async (layout, operation) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-json-after-rename-'))
  const backend = new JsonStorageBackend(root)
  onTestFinished(async () => {
    await backend.close()
    await rm(root, { recursive: true, force: true })
  })
  const shape = { ...descriptor, layout }
  const unit = await backend.kv.open(shape)
  const path = layout === 'single'
    ? join(root, 'uncertain.json')
    : join(root, 'uncertain', operation === 'global' ? 'global.json' : 't/a.json')
  await unit.putRecord('t', 'a', { value: 'before' })
  await unit.setGlobal({ value: 'before' })

  faults.syncDirectory = dirname(path)
  const change = operation === 'record'
    ? unit.putRecord('t', 'a', { value: 'after' })
    : operation === 'global'
      ? unit.setGlobal({ value: 'after' })
      : unit.deleteRecords('t', ['a'])
  await expect(change).rejects.toMatchObject({ code: 'unknown-state', cause: faults.failure })
  await expect(unit.loadAll()).rejects.toMatchObject({ code: 'unknown-state' })
  await expect(unit.putRecord('t', 'b', { value: 'blocked' })).rejects.toMatchObject({ code: 'unknown-state' })
  await expect(unit.setGlobal(null)).rejects.toMatchObject({ code: 'unknown-state' })
  await unit.close()

  // Not a crash test: closing and reopening inspects the currently visible file.
  faults.syncDirectory = undefined
  const reopened = await backend.kv.open(shape)
  expect(await reopened.loadAll()).toEqual({
    tables: { t: operation === 'delete' ? {} : { a: { value: operation === 'record' ? 'after' : 'before' } } },
    global: { value: operation === 'global' ? 'after' : 'before' },
  })
})
