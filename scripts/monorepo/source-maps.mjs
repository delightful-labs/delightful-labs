import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const libraries = new Map([
  ['delightful-ui', 'packages/ui'],
  ['delightful-local-first', 'packages/local-first']
])
const consumers = [
  'apps/website',
  'apps/finance',
  'apps/clipper/apps/web',
  'apps/clipper/apps/extension',
  'packages/local-first'
]

function* declarationMaps(directory) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) yield* declarationMaps(path)
    else if (entry.name.endsWith('.d.ts.map')) yield path
  }
}

// Resolve from the canonical build's maps, never from a previously adjusted copy.
// Package sources and published artifacts stay portable; only local installed
// declaration maps point outside the injected package to this checkout's sources.
const visited = new Set()
let updated = 0
for (const consumer of consumers) {
  for (const [name, project] of libraries) {
    const link = resolve(root, consumer, 'node_modules', name)
    if (!existsSync(link)) continue
    const installed = realpathSync(link)
    const canonical = resolve(root, project)
    if (installed === canonical || visited.has(installed)) continue
    visited.add(installed)
    for (const original of declarationMaps(resolve(canonical, 'dist'))) {
      const destination = resolve(installed, relative(canonical, original))
      if (!existsSync(destination)) continue
      const map = JSON.parse(readFileSync(original, 'utf8'))
      if (!Array.isArray(map.sources) || !map.sources.every((source) => typeof source === 'string')) {
        throw new Error(`Invalid declaration map: ${original}`)
      }
      map.sources = map.sources.map((source) => {
        const target = resolve(dirname(original), map.sourceRoot ?? '', source)
        // svelte-package can leave a component map pointing at a temporary
        // .svelte.ts snapshot that is never written to disk. Its positions are
        // generated TypeScript, so point component definitions at the real
        // component's entry rather than applying those offsets to Svelte text.
        const physical = existsSync(target) ? target : target.replace(/\.svelte\.[tj]s$/, '.svelte')
        if (!existsSync(physical)) throw new Error(`Missing declaration source: ${target}`)
        if (physical !== target) {
          if (map.sources.length !== 1) throw new Error(`Unsupported component map: ${original}`)
          map.mappings = map.mappings.split(';').map(() => 'AAAA').join(';')
          map.names = []
        }
        return relative(dirname(destination), physical).split(sep).join('/')
      })
      delete map.sourceRoot
      const contents = JSON.stringify(map)
      if (readFileSync(destination, 'utf8') === contents) continue
      // Injected files may be hard links. Replace the map atomically instead of
      // overwriting its inode and accidentally changing the canonical build.
      const temporary = `${destination}.${process.pid}.tmp`
      writeFileSync(temporary, contents)
      renameSync(temporary, destination)
      updated++
    }
  }
}
console.info(`Workspace source navigation: updated ${updated} installed declaration maps`)
