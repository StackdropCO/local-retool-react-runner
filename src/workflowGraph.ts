import { operationFor, type WorkflowBlock, type WorkflowDefinition, type WorkflowPlanBlock } from './workflowRunner.js'

export type WorkflowGraphNode = {
  id: string
  kind: WorkflowPlanBlock['operation']
  subtitle: string
  rank: number
  row: number
}

export type WorkflowGraphEdge = {
  from: string
  to: string
  portLabel?: string
}

export type WorkflowGraph = {
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
  /** block ids present in the workflow but unreachable from any trigger, left out of nodes/edges */
  unreachable: string[]
}

type RawEdge = { fromId: string; toId: string; portLabel?: string }

function rawEdgesInto(workflow: WorkflowDefinition, block: WorkflowBlock): RawEdge[] {
  const plain = (block.blockData.incomingOnSuccessEdges ?? []).map((uuid): RawEdge => ({
    fromId: workflow.byUuid.get(uuid)?.id ?? uuid,
    toId: block.id,
  }))
  const ported = (block.blockData.incomingPorts ?? []).map((port): RawEdge => {
    const source = workflow.byUuid.get(port.blockId)
    const portLabel = source?.blockData.outgoingPorts?.find((p) => p.id === port.portId)?.name
    return { fromId: source?.id ?? port.blockId, toId: block.id, portLabel }
  })
  return [...plain, ...ported]
}

/** Lays out the workflow the way Retool's own canvas reads it: triggers on the left,
 * each block one column to the right of its furthest predecessor. Blocks that can
 * never run (no path from a trigger) are reported separately instead of positioned. */
export function buildWorkflowGraph(workflow: WorkflowDefinition): WorkflowGraph {
  const edges = workflow.blocks.flatMap((block) => rawEdgesInto(workflow, block))
  const outgoing = new Map<string, RawEdge[]>()
  for (const edge of edges) outgoing.set(edge.fromId, [...(outgoing.get(edge.fromId) ?? []), edge])

  const triggers = workflow.blocks.filter((block) => operationFor(block) === 'trigger')
  const reachable = new Set<string>(triggers.map((b) => b.id))
  const queue = [...reachable]
  while (queue.length) {
    const current = queue.shift()!
    for (const edge of outgoing.get(current) ?? []) {
      if (reachable.has(edge.toId)) continue
      reachable.add(edge.toId)
      queue.push(edge.toId)
    }
  }

  const kept = workflow.blocks.filter((block) => reachable.has(block.id))
  const keptEdges = edges.filter((edge) => reachable.has(edge.fromId) && reachable.has(edge.toId))
  const incomingByTarget = new Map<string, RawEdge[]>()
  for (const edge of keptEdges) incomingByTarget.set(edge.toId, [...(incomingByTarget.get(edge.toId) ?? []), edge])

  const rank = new Map<string, number>()
  const rankOf = (id: string): number => {
    if (rank.has(id)) return rank.get(id)!
    const preds = incomingByTarget.get(id) ?? []
    const value = preds.length === 0 ? 0 : 1 + Math.max(...preds.map((e) => rankOf(e.fromId)))
    rank.set(id, value)
    return value
  }
  for (const block of kept) rankOf(block.id)

  const byRank = new Map<number, string[]>()
  for (const block of kept) byRank.set(rank.get(block.id)!, [...(byRank.get(rank.get(block.id)!) ?? []), block.id])

  const row = new Map<string, number>()
  const maxRank = Math.max(0, ...kept.map((b) => rank.get(b.id)!))
  for (let r = 0; r <= maxRank; r++) {
    const ids = byRank.get(r) ?? []
    const barycenter = (id: string): number => {
      const preds = (incomingByTarget.get(id) ?? []).map((e) => row.get(e.fromId)).filter((v): v is number => v !== undefined)
      return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : Number.MAX_SAFE_INTEGER
    }
    const ordered = [...ids].sort((a, b) => barycenter(a) - barycenter(b) || a.localeCompare(b))
    ordered.forEach((id, index) => row.set(id, index))
  }

  const byId = new Map(workflow.blocks.map((b) => [b.id, b]))
  const nodes: WorkflowGraphNode[] = kept.map((block) => ({
    id: block.id,
    kind: operationFor(block),
    subtitle: block.subtype ?? block.blockData.editorType ?? block.blockData.blockType,
    rank: rank.get(block.id)!,
    row: row.get(block.id)!,
  }))
  const resultEdges: WorkflowGraphEdge[] = keptEdges.map((e) => ({ from: e.fromId, to: e.toId, portLabel: e.portLabel }))
  const unreachable = workflow.blocks.filter((b) => !reachable.has(b.id)).map((b) => b.id)
  void byId
  return { nodes, edges: resultEdges, unreachable }
}

const KIND_COLOR: Record<WorkflowPlanBlock['operation'], string> = {
  trigger: '#2f8f5b',
  code: '#3a6fb0',
  condition: '#8a4fc9',
  rest: '#b0763a',
  sql: '#4a8f8f',
  response: '#b0433a',
  resource: '#6b7280',
}

const BOXW = 170
const BOXH = 56
const COLW = BOXW + 110
const ROWH = BOXH + 26
const MARGIN = 40

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Renders the graph as a standalone SVG, styled like Retool's own workflow canvas:
 * rounded cards color-coded by block kind, connected by curved edges (dashed + labeled
 * where they leave a conditional's named port). Opens directly in a browser. */
export function renderWorkflowGraphSvg(workflow: WorkflowDefinition): string {
  const graph = buildWorkflowGraph(workflow)
  const maxRow = Math.max(0, ...graph.nodes.map((n) => n.row))
  const maxRank = Math.max(0, ...graph.nodes.map((n) => n.rank))
  const width = MARGIN * 2 + (maxRank + 1) * COLW - (COLW - BOXW)
  const height = MARGIN * 2 + (maxRow + 1) * ROWH - (ROWH - BOXH)
  const pos = new Map(graph.nodes.map((n) => [n.id, { x: MARGIN + n.rank * COLW, y: MARGIN + n.row * ROWH }]))

  const edgesSvg = graph.edges
    .map((edge) => {
      const from = pos.get(edge.from)
      const to = pos.get(edge.to)
      if (!from || !to) return ''
      const x1 = from.x + BOXW
      const y1 = from.y + BOXH / 2
      const x2 = to.x
      const y2 = to.y + BOXH / 2
      const midX = (x1 + x2) / 2
      const dashed = edge.portLabel ? ' stroke-dasharray="6 5"' : ''
      const label = edge.portLabel
        ? `<text x="${midX}" y="${(y1 + y2) / 2 - 8}" font-size="10.5" font-style="italic" text-anchor="middle" fill="currentColor" opacity="0.75">${escapeXml(edge.portLabel)}</text>`
        : ''
      return `<path d="M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.6"${dashed} marker-end="url(#arrow)" />${label}`
    })
    .join('\n')

  const nodesSvg = graph.nodes
    .map((node) => {
      const p = pos.get(node.id)!
      const color = KIND_COLOR[node.kind]
      return `<g>
  <rect x="${p.x}" y="${p.y}" width="${BOXW}" height="${BOXH}" rx="8" fill="#15161c" stroke="${color}" stroke-width="1.5" />
  <rect x="${p.x}" y="${p.y}" width="5" height="${BOXH}" rx="2" fill="${color}" />
  <text x="${p.x + 14}" y="${p.y + 20}" font-size="12.5" font-weight="600" fill="#e7e8ec">${escapeXml(truncate(node.id, 20))}</text>
  <text x="${p.x + 14}" y="${p.y + 35}" font-size="10.5" fill="#9497a6">${escapeXml(truncate(node.subtitle, 24))}</text>
  <text x="${p.x + 14}" y="${p.y + 48}" font-size="9" letter-spacing="0.06em" fill="${color}">${node.kind.toUpperCase()}</text>
</g>`
    })
    .join('\n')

  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace, monospace">
<defs>
  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
    <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity="0.6" />
  </marker>
</defs>
<rect x="0" y="0" width="${width}" height="${height}" fill="#0b0c10" />
<g color="#9497a6">
${edgesSvg}
</g>
${nodesSvg}
</svg>`
}
