import { connectMcp } from '../mcpClient.js'

// The Shift Utilization Dashboard's real resource UUIDs (from its package.json
// resourceReferencesByFile). Resource.name IS the UUID.
const DATABRICKS = 'bc69c6a3-b8dc-4dd1-81f7-10705ecc8ad3'
const LAKEBASE = '089dd8fc-ec8d-4e34-8021-ef69d5ef7338'

async function main() {
  const mcp = await connectMcp()
  console.log('[probe] connected + authorized')

  const bindings = await mcp.getResourceBindings([DATABRICKS, LAKEBASE])
  console.log('[probe] bindings:', bindings.map((b) => `${b.resource_id.slice(0, 8)}→${b.variable_name} (${b.type})`).join(', '))

  const db = bindings.find((b) => b.resource_id === DATABRICKS)!
  const out = await mcp.executeResourceTs([DATABRICKS], `return await ${db.variable_name}.query("SELECT 1 AS ok")`)
  console.log('[probe] Databricks SELECT 1 unwrapped result:', JSON.stringify(out).slice(0, 800))

  await mcp.close()
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
