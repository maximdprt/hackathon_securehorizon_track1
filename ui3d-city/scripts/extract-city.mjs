// Extracts the Avalanche Builder Hub "City" view (BSD-3-Clause, Copyright (c) 2021, Ava Labs, Inc.)
// from a local clone into this app, keeping the same paths so the `@/*` alias works unchanged.
//
//   node scripts/extract-city.mjs [path/to/builders-hub] [--dry]
//
// Follows every import (relative and `@/...`) from the entry files, copies the closure, copies
// public/images/city3d/*, and writes VENDORED.md. Server-only imports (prisma, redis, clickhouse,
// AI SDKs...) are never copied: they are listed so a local stub with the same signature can stand in.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { execSync } from 'node:child_process'

const SRC = resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '../vendor/builders-hub')
const DRY = process.argv.includes('--dry')
const OUT = resolve('.')
const ENTRIES = [
  'components/explorer-v2/network/city3d/City3D.tsx',
  'components/explorer-v2/network/city-data.ts',
  'components/explorer-v2/network/city-key.tsx',
  'components/explorer-v2/staking/bits.tsx',
  'components/explorer-v2/network/city-frame.tsx',
]
// Files we replace by a local stub (kept out of the copy). Matched on the resolved repo path.
// city-app.tsx pulls 231 files (AI search, server reads, prisma); city-key.tsx only needs its `Height` type.
const STUB = [/^lib\/(prisma|db|redis|clickhouse)/, /^server\//, /ask-route/, /ask-window/, /^app\/api\//, /network\/city-app\.tsx$/]
const EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '/index.ts', '/index.tsx', '/index.js']

function resolveImport(fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null // npm package
  for (const e of EXT) {
    const p = base + e
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return undefined
}

const IMPORT_RE = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g
const seen = new Set()
const packages = new Map()
const stubs = new Map()
const missing = []
const queue = ENTRIES.map((e) => join(SRC, e))
while (queue.length) {
  const f = queue.shift()
  const rel = relative(SRC, f).replaceAll('\\', '/')
  if (seen.has(rel)) continue
  seen.add(rel)
  const code = readFileSync(f, 'utf8')
  for (const m of code.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4]
    if (!spec) continue
    const r = resolveImport(f, spec)
    if (r === null) {
      const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
      if (!packages.has(pkg)) packages.set(pkg, new Set())
      packages.get(pkg).add(rel)
      continue
    }
    if (r === undefined) {
      missing.push(`${rel} -> ${spec}`)
      continue
    }
    const target = relative(SRC, r).replaceAll('\\', '/')
    if (STUB.some((re) => re.test(target))) {
      if (!stubs.has(target)) stubs.set(target, new Set())
      stubs.get(target).add(rel)
      continue
    }
    queue.push(r)
  }
}

const files = [...seen].sort()
const assets = readdirSync(join(SRC, 'public/images/city3d')).map((f) => `public/images/city3d/${f}`)
// ambient declarations the vendored code relies on (no import points at them)
const AMBIENT = ['types/n8ao.d.ts']
if (!DRY) {
  for (const rel of [...files, ...AMBIENT, ...assets, 'LICENSE']) {
    const to = rel === 'LICENSE' ? join(OUT, 'LICENSES/builders-hub-LICENSE') : join(OUT, rel)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(join(SRC, rel), to)
  }
}
let commit = 'unknown'
try {
  commit = execSync('git rev-parse HEAD', { cwd: SRC }).toString().trim()
} catch {}

const md = `# Vendored code

The 3D City is extracted from **Avalanche Builder Hub** (https://github.com/ava-labs/builders-hub),
commit \`${commit}\`, under the BSD 3-Clause License (Copyright (c) 2021, Ava Labs, Inc.), see
\`LICENSES/builders-hub-LICENSE\`. This project is not endorsed by Ava Labs. Their logos, wordmark and
site navigation are not used. Every local change to a vendored file is marked \`// AVAGUARD:\`.

Regenerate with \`node scripts/extract-city.mjs <path to builders-hub>\`.

## Files copied as is (${files.length} + ${AMBIENT.length} declaration + ${assets.length} images)

${[...files, ...AMBIENT].map((f) => `- \`${f}\``).join('\n')}
${assets.map((f) => `- \`${f}\``).join('\n')}

## Replaced by local stubs

${[...stubs].map(([t, by]) => `- \`${t}\` (imported by ${[...by].map((b) => `\`${b}\``).join(', ')})`).join('\n') || '- none'}

## npm packages used by the vendored code

${[...packages].sort().map(([p, by]) => `- \`${p}\` (${by.size} file${by.size > 1 ? 's' : ''})`).join('\n')}
${missing.length ? `\n## Unresolved imports\n\n${missing.map((m) => `- ${m}`).join('\n')}\n` : ''}`
if (!DRY) writeFileSync(join(OUT, 'VENDORED.md'), md)
console.log(`${files.length} files, ${assets.length} images, ${stubs.size} stubbed, ${packages.size} packages, ${missing.length} unresolved`)
for (const [p, by] of [...packages].sort()) console.log("pkg", p, [...by].slice(0, 4).join(", "))
if (stubs.size) console.log('stubs:', [...stubs.keys()].join(' '))
if (missing.length) console.log('unresolved:', missing.join(' | '))
