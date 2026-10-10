// One-time snapshot of the public builders-hub routes the City reads, so the app runs offline and never polls
// their server (section 3). Run once:   node scripts/snapshot.mjs [--logos-only] [path/to/builders-hub]
// Routes come from fixtures/_routes.json (written by app/api/[...path]/route.ts in record mode, SNAPSHOT_RECORD=1),
// or from the default list below. Chain logos the snapshots point at as local /images/... paths are copied
// from the builders-hub clone into public/.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const UPSTREAM = 'https://build.avax.network'
const DIR = resolve('fixtures')
const args = process.argv.slice(2)
const LOGOS_ONLY = args.includes('--logos-only')
const HUB = resolve(args.find((a) => !a.startsWith('--')) ?? '../vendor/builders-hub')
const DEFAULT = [
  '/api/overview-stats?timeRange=month&network=fuji',
  '/api/overview-stats?timeRange=day&network=fuji',
  '/api/icm-flow?days=1&sides=both&network=fuji',
  '/api/l1-registry/fuji',
  '/api/pchain/fuji/stats',
  '/api/pchain/fuji/txs?limit=20',
  '/api/pchain/fuji/txs?limit=96',
]

// same file naming as the route handler
function fileOf(method, path, search, body) {
  const q = new URLSearchParams(search)
  q.sort()
  const raw = `${method} ${path}?${q.toString()}${body ? ` ${body}` : ''}`
  const slug = `${method}_${path}`.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80)
  return `${slug}_${createHash('sha1').update(raw).digest('hex').slice(0, 10)}.json`
}

mkdirSync(DIR, { recursive: true })
if (!LOGOS_ONLY) {
  const recorded = existsSync(join(DIR, '_routes.json')) ? JSON.parse(readFileSync(join(DIR, '_routes.json'), 'utf8')) : []
  const list = recorded.length ? recorded : DEFAULT.map((u) => ({ method: 'GET', path: u.split('?')[0], search: u.includes('?') ? `?${u.split('?')[1]}` : '', body: '' }))
  for (const r of list) {
    const url = `${UPSTREAM}${r.path}${r.search}`
    const res = await fetch(url, { method: r.method, body: r.body || undefined, headers: r.body ? { 'content-type': 'application/json' } : undefined })
    const body = await res.text()
    const file = fileOf(r.method, r.path, r.search, r.body)
    writeFileSync(join(DIR, file), JSON.stringify({ url, method: r.method, status: res.status, contentType: res.headers.get('content-type') ?? 'application/json', takenAt: new Date().toISOString(), body }))
    console.log(res.status, r.method, r.path + r.search, '->', file)
  }
}

// logos the feeds name as local paths (/images/...) come from the builders-hub clone
const logos = new Set()
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'))) {
  const { body } = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
  for (const m of String(body).matchAll(/"(\/images\/[^"?#]+\.(?:svg|png|jpe?g|webp))"/g)) logos.add(m[1])
}
let copied = 0
for (const l of logos) {
  const from = join(HUB, 'public', l)
  const to = join(resolve('public'), l)
  if (existsSync(from) && !existsSync(to)) {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    copied++
  }
}
writeFileSync(join(DIR, '_snapshot.json'), JSON.stringify({ source: UPSTREAM, network: 'fuji', takenAt: new Date().toISOString(), logos: [...logos] }, null, 2))
console.log(`${logos.size} local logo path(s), ${copied} copied from ${HUB}`)
