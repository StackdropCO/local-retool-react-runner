import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkflowGraph } from '../../../workflowGraph'
import type { WorkflowBlock } from '../../../workflowRunner'
import { Button } from './ui/button'
import { Input } from './ui/input'
import './workflow-canvas.css'

type Graph = WorkflowGraph & { name: string; directory: string; blocks: WorkflowBlock[] }
const colors: Record<string, string> = {
  trigger: '#29805a', code: '#426cb2', condition: '#8855be', sql: '#2f8586',
  rest: '#ad7133', response: '#b64e59', resource: '#6b7280',
}
const position = (node: WorkflowGraph['nodes'][number]) => ({ x: node.rank * 310 + 60, y: node.row * 120 + 60 })

export function WorkflowCanvas() {
  const [directory, setDirectory] = useState(() => new URLSearchParams(window.location.search).get('workflow') ?? '')
  const [activeDirectory, setActiveDirectory] = useState(directory)
  const [graph, setGraph] = useState<Graph | null>(null)
  const [error, setError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [inspectorWidth, setInspectorWidth] = useState(42)
  const [view, setView] = useState({ x: 20, y: 40, scale: 0.8 })
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const graphRef = useRef<Graph | null>(null)
  const fit = useCallback((data = graphRef.current) => {
    if (!data || !viewport.current) return
    const width = Math.max(400, ...data.nodes.map((node) => position(node).x + 280))
    const height = Math.max(240, ...data.nodes.map((node) => position(node).y + 140))
    const scale = Math.min(1, viewport.current.clientWidth / width, viewport.current.clientHeight / height)
    setView({ x: 0, y: (viewport.current.clientHeight - height * scale) / 2, scale })
  }, [])

  useEffect(() => {
    if (!activeDirectory) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let first = graphRef.current?.directory !== activeDirectory
    const refresh = async () => {
      setRefreshing(true)
      try {
        const response = await fetch(`/api/workflow/graph?directory=${encodeURIComponent(activeDirectory)}`, { signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error ?? 'Unable to load workflow')
        if (controller.signal.aborted) return
        if (JSON.stringify(data) !== JSON.stringify(graphRef.current)) {
          graphRef.current = data
          setGraph(data)
        }
        setError('')
        if (first) { fit(data); first = false }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!controller.signal.aborted) {
          setRefreshing(false)
          timer = setTimeout(refresh, 10_000)
        }
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [activeDirectory, fit, reloadVersion])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      setView((current) => {
        const scale = Math.max(0.08, Math.min(2.5, current.scale * Math.exp(-event.deltaY * 0.002)))
        return { scale, x: x - (x - current.x) * scale / current.scale, y: y - (y - current.y) * scale / current.scale }
      })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [])

  const block = graph?.blocks.find((item) => item.id === selected)
  const positions = new Map(graph?.nodes.map((node) => [node.id, position(node)]) ?? [])
  return <section className="workflow-workspace">
    <form className="workflow-toolbar" onSubmit={(event) => {
      event.preventDefault()
      setSelected(null)
      setActiveDirectory(directory)
      const url = new URL(window.location.href)
      url.searchParams.set('workflow', directory)
      window.history.replaceState(null, '', url)
    }}>
      <Input aria-label="Workflow folder" placeholder="Paste a workflow folder path…" value={directory} onChange={(event) => setDirectory(event.target.value)} />
      <Button type="submit">Open workflow</Button>
      <Button type="button" variant="outline" disabled={!activeDirectory || refreshing} onClick={() => setReloadVersion((value) => value + 1)}>{refreshing ? 'Reloading…' : 'Reload'}</Button>
    </form>
    <div className="workflow-title"><div><h2>{graph?.name ?? 'Your workflow canvas'}</h2><p>{graph ? `${graph.nodes.length} connected blocks · Updates from disk every 10 seconds` : 'Open a local Retool workflow to explore its connections.'}</p></div><span className="workflow-live">{error ? 'Update paused' : activeDirectory ? '● Live' : 'Local'}</span></div>
    {error && <p role="alert" className="workflow-error">{error}</p>}
    <div className={`workflow-body ${block ? 'workflow-inspecting' : ''}`} style={block ? { gridTemplateColumns: `minmax(0, 1fr) 8px minmax(0, ${inspectorWidth}%)` } : undefined}>
      <div ref={viewport} className="workflow-viewport" aria-label="Interactive workflow canvas"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('button')) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y }
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (start) setView((current) => ({ ...current, x: start.startX + event.clientX - start.x, y: start.startY + event.clientY - start.y }))
        }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
        {!graph && <div className="workflow-empty">Your workflow, with room to explore.<small>Drag to pan · Scroll to zoom · Select a block for details</small></div>}
        <div className="workflow-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg className="workflow-edges" width="1" height="1" aria-hidden="true">
            <defs><marker id="workflow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9c9ba9" /></marker></defs>
            {graph?.edges.map((edge, index) => {
              const from = positions.get(edge.from)!
              const to = positions.get(edge.to)!
              const start = from.x + 230
              const middle = (start + to.x) / 2
              const active = edge.from === selected || edge.to === selected
              return <g key={index} className={active ? 'workflow-edge-active' : ''}>
                <path d={`M ${start} ${from.y + 40} C ${middle} ${from.y + 40}, ${middle} ${to.y + 40}, ${to.x} ${to.y + 40}`} fill="none" stroke={active ? '#1a1830' : '#b4b1be'} strokeWidth={active ? 3 : 2} strokeDasharray={edge.portLabel !== undefined ? '6 5' : undefined} markerEnd="url(#workflow-arrow)" />
                {edge.portLabel !== undefined && <text x={middle} y={(from.y + to.y) / 2 + 29} textAnchor="middle" fill="#736482" fontSize="12" fontStyle="italic">{edge.portLabel}</text>}
              </g>
            })}
          </svg>
          {graph?.nodes.map((node) => {
            const p = position(node)
            return <button type="button" key={node.id} aria-pressed={node.id === selected} className="workflow-node" style={{ left: p.x, top: p.y, borderLeftColor: colors[node.kind] }} onClick={() => setSelected(node.id)}>
              <span style={{ color: colors[node.kind] }}>{node.kind}</span><strong title={node.id}>{node.id}</strong><small>{node.subtitle}</small>
            </button>
          })}
        </div>
        <div className="workflow-controls"><Button variant="outline" size="sm" onClick={() => setView((current) => ({ ...current, scale: Math.min(2.5, current.scale * 1.2) }))} aria-label="Zoom in">+</Button><span>{Math.round(view.scale * 100)}%</span><Button variant="outline" size="sm" onClick={() => setView((current) => ({ ...current, scale: Math.max(0.08, current.scale / 1.2) }))} aria-label="Zoom out">−</Button><Button variant="outline" size="sm" onClick={() => fit()}>Fit</Button></div>
      </div>
      {block && <>
        <div className="workflow-divider" role="separator" tabIndex={0} aria-label="Resize query inspector" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={inspectorWidth}
          onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId) }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            const rect = event.currentTarget.parentElement!.getBoundingClientRect()
            setInspectorWidth(Math.max(25, Math.min(75, (rect.right - event.clientX) / rect.width * 100)))
          }}
          onPointerUp={(event) => { event.currentTarget.releasePointerCapture(event.pointerId) }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            setInspectorWidth((value) => Math.max(25, Math.min(75, value + (event.key === 'ArrowLeft' ? 2 : -2))))
          }} />
        <aside className="workflow-details"><div className="workflow-detail-heading"><h3>{block.id}</h3><Button size="sm" variant="ghost" onClick={() => setSelected(null)} aria-label="Close block details">×</Button></div><p>{block.blockData.blockType} · {block.subtype}</p>{block.resourceDisplayName && <p>Resource: {block.resourceDisplayName}</p>}<h4>Query / code</h4><pre>{String(block.template?.query ?? 'No query configured')}</pre><h4>Block configuration</h4><pre>{JSON.stringify(block.blockData, null, 2)}</pre></aside>
      </>}
    </div>
    {!!graph?.unreachable.length && <details className="workflow-unreachable"><summary>{graph.unreachable.length} disconnected blocks</summary><p>{graph.unreachable.join(' · ')}</p></details>}
  </section>
}
