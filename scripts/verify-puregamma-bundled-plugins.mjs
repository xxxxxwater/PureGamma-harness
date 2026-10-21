/** Verify that a packaged desktop app contains the exact bundled plugin archives. */

import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const resourceRoot = process.argv[2]
if (!resourceRoot) throw new Error('Pass the packaged pg-harness resource directory')

const bundledRoot = join(resolve(resourceRoot), 'bundled-plugins')
const inventory = JSON.parse(readFileSync(join(bundledRoot, 'inventory.json'), 'utf8'))
if (!Array.isArray(inventory.plugins) || !Array.isArray(inventory.bundles)) {
  throw new Error('Invalid bundled plugin inventory')
}

const purge = inventory.plugins.find(plugin => plugin.name === 'dsh-purge')
if (!inventory.bundles.includes('dsh-purge')
  || purge?.version !== '1.1.71-puregamma.4'
  || purge.archive !== 'dsh-purge-1.1.71-puregamma.4.tgz') {
  throw new Error('Packaged app is missing the PureGamma dsh-purge .4 Clean build')
}

const names = new Set()
for (const plugin of inventory.plugins) {
  if (names.has(plugin.name)) throw new Error(`Duplicate bundled plugin: ${plugin.name}`)
  names.add(plugin.name)
  if (typeof plugin.archive !== 'string' || basename(plugin.archive) !== plugin.archive
    || !/^[a-f0-9]{64}$/.test(plugin.sha256)) {
    throw new Error(`Invalid bundled plugin archive record: ${plugin.name}`)
  }
  const path = join(bundledRoot, plugin.archive)
  if (!lstatSync(path).isFile()) throw new Error(`Not a regular bundled plugin archive: ${plugin.archive}`)
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (actual !== plugin.sha256) throw new Error(`Bundled plugin archive checksum mismatch: ${plugin.archive}`)
}

console.log(`Verified ${names.size} packaged plugin archives, including dsh-purge ${purge.version}`)
