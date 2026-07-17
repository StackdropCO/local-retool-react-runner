import { spawn, type ChildProcess } from 'node:child_process'
import { watch, existsSync } from 'node:fs'
import { join } from 'node:path'
import { TOOL_ROOT, DEFAULT_APP_DIR } from './paths.js'

// Dev launcher: runs the server and restarts it on backend / tool-source
// changes. The app's FRONTEND is hot-reloaded by Vite inside the child (no
// restart needed) — we only restart for backend/*.ts and the tool's own src,
// which run in the Node process and are otherwise module-cached.

function argVal(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const appDir = argVal('app', DEFAULT_APP_DIR)
const passthroughArgs = process.argv.slice(2) // forward --app/--port/--writes to the child
const tsxBin = join(TOOL_ROOT, 'node_modules', '.bin', 'tsx')

let child: ChildProcess | null = null
let restarting = false

function start() {
  child = spawn(tsxBin, ['src/index.ts', ...passthroughArgs], { stdio: 'inherit', cwd: TOOL_ROOT })
  child.on('exit', (code) => {
    if (restarting) {
      restarting = false
      start()
    } else if (code !== null && code !== 0) {
      process.exit(code)
    }
  })
}

let debounce: NodeJS.Timeout | null = null
function scheduleRestart(reason: string) {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    console.log(`\n[dev] change in ${reason} — restarting server…`)
    if (child && !restarting) {
      restarting = true
      child.kill('SIGTERM') // child.on('exit') respawns once the port is free
    }
  }, 200)
}

start()

const watchDirs = [
  { dir: join(TOOL_ROOT, 'src'), label: 'tool src' },
  { dir: join(appDir, 'backend'), label: 'app backend' },
].filter((w) => existsSync(w.dir))

for (const { dir, label } of watchDirs) {
  watch(dir, { recursive: true }, (_event, file) => {
    if (!file || /\.tsx?$/.test(file)) scheduleRestart(label)
  })
  console.log(`[dev] watching ${label}: ${dir}`)
}

// Kill the child and exit when the parent (e.g. the panel) stops us.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    restarting = false // don't respawn on this exit
    child?.kill('SIGTERM')
    process.exit(0)
  })
}
