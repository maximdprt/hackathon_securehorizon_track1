// Drives a page in headless Chrome over the DevTools protocol (Node 22 has fetch + WebSocket, no dependency):
// key presses, waits, evaluations and screenshots, for the phase captures and the GIF.
//   node tools/capture.mjs <plan.json>
// plan: { url, out, width, height, steps: [ {wait}, {key:"Digit1"}, {shot:"name"}, {frames:{prefix,count,every}},
//         {eval:"js"}, {log:"js expression"}, {click:[x,y]}, {move:[x,y]}, {evalMove:"registry"}, {evalClick:"hub"} ] }
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const plan = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const out = resolve(plan.out)
mkdirSync(out, { recursive: true })
const W = plan.width ?? 1920
const H = plan.height ?? 1080
const port = 9333 + Math.floor(Math.random() * 400)
// an absolute profile path: a relative one makes Chrome open an error dialog on the desktop
const profile = resolve('tools/.chrome-profile')
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  `--window-size=${W},${H}`, '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', 'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let page
for (let i = 0; i < 80 && !page; i++) {
  await sleep(250)
  try {
    page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')
  } catch {}
}
if (!page) throw new Error('chrome did not start')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pending = new Map()
const consoleLines = []
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  } else if (msg.method === 'Runtime.exceptionThrown') consoleLines.push(`EXCEPTION ${msg.params.exceptionDetails.exception?.description?.slice(0, 500) ?? msg.params.exceptionDetails.text}`)
  else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) consoleLines.push(`${msg.params.type.toUpperCase()} ${msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400)}`)
  else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) consoleLines.push(`HTTP ${msg.params.response.status} ${msg.params.response.url.slice(0, 200)}`)
}
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value

await send('Page.enable')
await send('Runtime.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
if (plan.reducedMotion) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
await send('Page.navigate', { url: plan.url })

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 })
  writeFileSync(join(out, `${name}.jpg`), Buffer.from(r.result.data, 'base64'))
}
const KEYS = { Space: ' ', Escape: 'Escape' }
for (const s of plan.steps) {
  if (s.wait) await sleep(s.wait)
  if (s.key) {
    const key = KEYS[s.key] ?? (s.key.startsWith('Digit') ? s.key.slice(5) : s.key.startsWith('Key') ? s.key.slice(3).toLowerCase() : s.key)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', code: s.key, key })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', code: s.key, key })
  }
  // a door's place on screen, from the page's own test handle (city3d/AvaGuardRun.tsx window.__doorAt)
  const door = s.evalMove ?? s.evalClick
  if (door) {
    const at = await evaluate(`window.__doorAt && window.__doorAt(${JSON.stringify(door)})`)
    if (at) s[s.evalMove ? 'move' : 'click'] = at
    console.log('DOOR', door, '=>', JSON.stringify(at))
  }
  if (s.move) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.move[0], y: s.move[1] })
  if (s.click) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.click[0], y: s.click[1] })
    await sleep(120)
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.click[0], y: s.click[1], button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.click[0], y: s.click[1], button: 'left', clickCount: 1 })
  }
  if (s.eval) await evaluate(s.eval)
  if (s.log) console.log('LOG', s.label ?? s.log.slice(0, 60), '=>', JSON.stringify(await evaluate(s.log)))
  if (s.shot) await shot(s.shot)
  if (s.frames) {
    for (let i = 0; i < s.frames.count; i++) {
      const t0 = Date.now()
      await shot(`${s.frames.prefix}_${String(i).padStart(3, '0')}`)
      await sleep(Math.max(0, s.frames.every - (Date.now() - t0)))
    }
  }
}
writeFileSync(join(out, 'console.txt'), consoleLines.join('\n'))
console.log(`console: ${consoleLines.length} line(s)`)
for (const l of consoleLines.slice(0, 25)) console.log('  ', l)
ws.close()
chrome.kill()
process.exit(0)
