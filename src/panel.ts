import { startPanel } from './panel/server.js'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

startPanel(Number(arg('port', '5170')))
