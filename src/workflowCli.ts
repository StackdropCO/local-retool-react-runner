import open from 'open'
import { loadWorkflow, loadWorkflowFixture, planWorkflow, runWorkflow, type WorkflowRunMode } from './workflowRunner.js'

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

async function main() {
  const directory = arg('workflow')
  const mode = (arg('mode') ?? 'dry-run') as WorkflowRunMode | 'graph'
  if (!directory) throw new Error('Usage: pnpm workflow -- --workflow /path/to/workflow [--mode dry-run|mock|docker|graph] [--fixture profile.yml] [--port 5171]')
  if (!['dry-run', 'mock', 'docker', 'graph'].includes(mode)) throw new Error(`Unknown workflow mode: ${mode}`)
  const workflow = loadWorkflow(directory)
  if (mode === 'graph') {
    const port = Number(arg('port') ?? 5171)
    if (!Number.isInteger(port) || port < 1 || port > 45535) throw new Error('Port must be between 1 and 45535')
    const { createPanelServer } = await import('./panel/server.js')
    const panel = await createPanelServer(port)
    const url = `${panel.url}/?workflow=${encodeURIComponent(workflow.directory)}`
    console.log(`Live workflow canvas: ${url}`)
    await open(url).catch(() => undefined)
    const stop = async () => { await panel.close(); process.exit(0) }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    return
  }
  if (mode === 'dry-run') {
    const plan = planWorkflow(workflow)
    console.log(JSON.stringify(plan, null, 2))
    if (plan.errors.length) process.exitCode = 1
    return
  }
  const fixturePath = arg('fixture')
  if (!fixturePath) throw new Error(`${mode} mode requires --fixture profile.yml`)
  const result = await runWorkflow({ workflow, mode, fixture: loadWorkflowFixture(fixturePath), fixturePath })
  console.log(JSON.stringify(result, null, 2))
  if (result.status !== 'success') process.exitCode = 1
}

main().catch((error) => {
  console.error(String((error as Error)?.message ?? error))
  process.exit(1)
})
