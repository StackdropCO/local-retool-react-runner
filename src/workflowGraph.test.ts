import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { buildWorkflowGraph, renderWorkflowGraphSvg } from './workflowGraph.js'
import { loadWorkflow } from './workflowRunner.js'

function workflow() {
  const directory = mkdtempSync(join(tmpdir(), 'workflow-graph-'))
  writeFileSync(join(directory, 'workflow.yml'), 'name: Graph test\nworkflowId: graph-1\n')
  const blocks = [
    { id: 'startTrigger', subtype: 'JavascriptQuery', blockData: { uuid: 'start', blockType: 'webhook' } },
    { id: 'prepare', subtype: 'JavascriptQuery', blockData: { uuid: 'prepare', blockType: 'code', incomingOnSuccessEdges: ['start'] } },
    { id: 'choose', subtype: 'JavascriptQuery', blockData: {
      uuid: 'choose', blockType: 'conditional', incomingOnSuccessEdges: ['prepare'],
      outgoingPorts: [{ id: 'sql-port', name: 'Save' }, { id: 'rest-port', name: 'Fetch' }],
    } },
    { id: 'save', subtype: 'SqlQueryUnified', blockData: {
      uuid: 'save', blockType: 'default', incomingOnSuccessEdges: [],
      incomingPorts: [{ blockId: 'choose', portId: 'sql-port' }],
    } },
    { id: 'fetch', subtype: 'RESTQuery', blockData: {
      uuid: 'fetch', blockType: 'default', incomingOnSuccessEdges: [],
      incomingPorts: [{ blockId: 'choose', portId: 'rest-port' }],
    } },
    { id: 'join', subtype: 'JavascriptQuery', blockData: { uuid: 'join', blockType: 'code', incomingOnSuccessEdges: ['save', 'fetch'] } },
    { id: 'response', subtype: 'JavascriptQuery', blockData: { uuid: 'response', blockType: 'webhookReturn', incomingOnSuccessEdges: ['join'] } },
    { id: 'unused', subtype: 'JavascriptQuery', blockData: { uuid: 'unused', blockType: 'code', incomingOnSuccessEdges: [] } },
  ]
  for (const block of blocks) writeFileSync(join(directory, `${block.id}.yml`), stringify(block))
  return loadWorkflow(directory)
}

describe('workflow graph', () => {
  it('includes each reachable block with its operation kind and left-to-right rank', () => {
    const graph = buildWorkflowGraph(workflow())
    expect(Object.fromEntries(graph.nodes.map((node) => [node.id, node.kind]))).toEqual({
      startTrigger: 'trigger', prepare: 'code', choose: 'condition', save: 'sql',
      fetch: 'rest', join: 'code', response: 'response',
    })
    const ranks = new Map(graph.nodes.map((node) => [node.id, node.rank]))
    for (const edge of graph.edges) expect(ranks.get(edge.to)).toBeGreaterThan(ranks.get(edge.from)!)
    expect(ranks.get('save')).toBe(ranks.get('fetch'))
    expect(ranks.get('join')).toBe(ranks.get('save')! + 1)
  })

  it('places nodes in distinct rows within each rank', () => {
    const graph = buildWorkflowGraph(workflow())
    const positions = graph.nodes.map((node) => `${node.rank}:${node.row}`)
    expect(new Set(positions).size).toBe(graph.nodes.length)
  })

  it('preserves named conditional ports on edges', () => {
    const graph = buildWorkflowGraph(workflow())
    expect(graph.edges).toContainEqual({ from: 'choose', to: 'save', portLabel: 'Save' })
    expect(graph.edges).toContainEqual({ from: 'choose', to: 'fetch', portLabel: 'Fetch' })
  })

  it('reports disconnected blocks separately from positioned nodes and edges', () => {
    const graph = buildWorkflowGraph(workflow())
    expect(graph.unreachable).toEqual(['unused'])
    expect(graph.nodes.some((node) => node.id === 'unused')).toBe(false)
    expect(graph.edges.some((edge) => edge.from === 'unused' || edge.to === 'unused')).toBe(false)
  })

  it('renders standalone SVG with curved, dashed, labeled port edges', () => {
    const svg = renderWorkflowGraphSvg(workflow())
    expect(svg).toMatch(/^<svg /)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('stroke-dasharray="6 5"')
    expect(svg).toContain('font-style="italic"')
    expect(svg).toContain('>Save</text>')
    expect(svg).toMatch(/<path d="M \d+ \d+ C /)
    expect(svg).toContain('marker-end="url(#arrow)"')
    expect(svg).not.toContain('>unused</text>')
  })
})
