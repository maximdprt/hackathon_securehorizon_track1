// Dev helper: prints the import chain from the City entry files to a given module.
//   node scripts/import-chains.mjs <builders-hub> <substring> [...]
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const SRC = resolve(process.argv[2])
const EXT = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']
const RE = /(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g
const posix = (p) => p.split(sep).join('/')
function res(f, s) {
  let b
  if (s.startsWith('@/')) b = join(SRC, s.slice(2))
  else if (s.startsWith('.')) b = resolve(dirname(f), s)
  else return null
  for (const e of EXT) {
    const p = b + e
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  return null
}
const entries = ['components/explorer-v2/network/city3d/City3D.tsx', 'components/explorer-v2/network/city-data.ts', 'components/explorer-v2/network/city-key.tsx', 'components/explorer-v2/staking/bits.tsx']
const parent = new Map()
const seen = new Set()
const q = entries.map((e) => join(SRC, e))
while (q.length) {
  const f = q.shift()
  const rel = posix(relative(SRC, f))
  if (seen.has(rel)) continue
  seen.add(rel)
  for (const m of readFileSync(f, 'utf8').matchAll(RE)) {
    const r = res(f, m[1] ?? m[2] ?? m[3])
    if (!r) continue
    const t = posix(relative(SRC, r))
    if (!parent.has(t) && !seen.has(t)) parent.set(t, rel)
    q.push(r)
  }
}
for (const target of process.argv.slice(3)) {
  let t = [...seen].find((s) => s.includes(target))
  const chain = []
  while (t) {
    chain.push(t)
    t = parent.get(t)
  }
  console.log(chain.join('\n   <- '), '\n')
}
const only = (pre) => [...seen].filter((s) => s.startsWith(pre)).length
console.log('total', seen.size, '| city3d', only('components/explorer-v2/network/city3d'), '| network', only('components/explorer-v2/network/'), '| toolbox', only('components/toolbox'), '| lib', only('lib/'))
console.log('other:', [...seen].filter((s) => !s.startsWith('components/explorer-v2/network/') && !s.startsWith('components/toolbox') && !s.startsWith('lib/')).join(' '))
