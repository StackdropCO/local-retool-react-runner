import { execFileSync } from 'node:child_process'
import { afterEach, describe, it, expect } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resolveAppDirectory, scanApps } from './scan.js'

// Set RETOOL_TEST_APP to an apps-v2 app dir to exercise scan against real data.
const APP = process.env.RETOOL_TEST_APP || ''
const REPO = APP ? dirname(dirname(dirname(APP))) : ''

describe.skipIf(!APP || !existsSync(APP))('scanApps (set RETOOL_TEST_APP to run)', () => {
  it('finds apps under a repo with their endpoints and resources', () => {
    const apps = scanApps(REPO)
    expect(apps.length).toBeGreaterThan(0)
    const target = apps.find((a) => APP.endsWith(a.path.split('/').slice(-1)[0]))!
    expect(target).toBeTruthy()
    expect(target.endpoints.length).toBeGreaterThan(0)
    expect(target.resources.length).toBeGreaterThan(0)
  })
})

const temporaryDirectories: string[] = []

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('scanApps worktree targets', () => {
  it('treats a standalone Retool CLI checkout as a runnable app source', () => {
    const checkout = mkdtempSync(join(tmpdir(), 'local-mcp-runner-checkout-'))
    temporaryDirectories.push(checkout)
    mkdirSync(join(checkout, 'frontend'), { recursive: true })
    mkdirSync(join(checkout, '.retool'), { recursive: true })
    writeFileSync(join(checkout, 'package.json'), JSON.stringify({ retool: { app: { name: 'CLI App', uuid: 'cli-app-uuid' } } }))
    writeFileSync(join(checkout, 'frontend', 'App.tsx'), 'export default function App() { return null }\n')
    writeFileSync(join(checkout, '.retool', 'app.json'), '{}')

    const [app] = scanApps(checkout)

    expect(resolveAppDirectory(checkout)).toBe(realpathSync(checkout))
    expect(app).toMatchObject({ name: 'CLI App', uuid: 'cli-app-uuid', path: realpathSync(checkout), branch: null })
    expect(app.worktrees).toEqual([{
      worktreePath: realpathSync(checkout),
      appPath: realpathSync(checkout),
      branch: null,
      head: '',
      dirty: false,
      cliCheckout: true,
    }])
  })

  it('keeps each cloned app scoped to its own checkout under a shared parent folder', () => {
    const parent = mkdtempSync(join(tmpdir(), 'local-mcp-runner-apps-root-'))
    temporaryDirectories.push(parent)
    for (const [id, name] of [['app-one', 'App One'], ['app-two', 'App Two']]) {
      const checkout = join(parent, id)
      mkdirSync(join(checkout, 'frontend'), { recursive: true })
      mkdirSync(join(checkout, '.retool'), { recursive: true })
      writeFileSync(join(checkout, 'package.json'), JSON.stringify({ retool: { app: { name } } }))
      writeFileSync(join(checkout, 'frontend', 'App.tsx'), 'export default function App() { return null }\n')
      writeFileSync(join(checkout, '.retool', 'app.json'), '{}')
    }

    const apps = scanApps(parent)

    expect(apps.map((app) => ({
      name: app.name,
      appPath: app.worktrees[0]?.appPath,
      worktreePath: app.worktrees[0]?.worktreePath,
      cliCheckout: app.worktrees[0]?.cliCheckout,
    }))).toEqual([
      { name: 'App One', appPath: realpathSync(join(parent, 'app-one')), worktreePath: realpathSync(join(parent, 'app-one')), cliCheckout: true },
      { name: 'App Two', appPath: realpathSync(join(parent, 'app-two')), worktreePath: realpathSync(join(parent, 'app-two')), cliCheckout: true },
    ])
  })

  it('maps an app to its exact path in every registered worktree', () => {
    const parent = mkdtempSync(join(tmpdir(), 'local-mcp-runner-scan-'))
    temporaryDirectories.push(parent)
    const main = join(parent, 'repo')
    const feature = join(parent, 'feature')
    const relativeApp = join('apps-v2', 'Operations', 'Example App')
    const mainApp = join(main, relativeApp)
    mkdirSync(join(mainApp, 'frontend'), { recursive: true })
    writeFileSync(join(mainApp, 'package.json'), JSON.stringify({ retool: { app: { name: 'Example App' } } }))
    writeFileSync(join(mainApp, 'frontend', 'App.tsx'), 'export default function App() { return null }\n')
    git(main, ['init', '-b', 'main'])
    git(main, ['add', '.'])
    git(main, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'initial'])
    git(main, ['worktree', 'add', '-b', 'feature', feature])
    writeFileSync(join(feature, relativeApp, 'frontend', 'App.tsx'), 'export default function App() { return <p>agent edit</p> }\n')

    const [app] = scanApps(main)

    expect(app.worktrees).toEqual([
      expect.objectContaining({
        worktreePath: realpathSync(main),
        appPath: realpathSync(mainApp),
        branch: 'main',
        dirty: false,
      }),
      expect.objectContaining({
        worktreePath: realpathSync(feature),
        appPath: realpathSync(join(feature, relativeApp)),
        branch: 'feature',
        dirty: true,
      }),
    ])
  })
})
