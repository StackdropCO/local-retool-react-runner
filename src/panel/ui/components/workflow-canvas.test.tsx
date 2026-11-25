// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkflowCanvas } from './workflow-canvas'

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/') })

it('opens a workflow, inspects its block and supports zoom controls', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    name: 'Vacation sync', directory: '/tmp/workflow', unreachable: ['unused'], edges: [],
    nodes: [{ id: 'prepare', kind: 'code', subtitle: 'JavascriptQuery', rank: 0, row: 0 }],
    blocks: [{ id: 'prepare', subtype: 'JavascriptQuery', template: { query: 'return 42' }, blockData: { uuid: 'prepare', blockType: 'code' } }],
  }) })
  vi.stubGlobal('fetch', fetchMock)
  render(<WorkflowCanvas />)
  fireEvent.change(screen.getByLabelText('Workflow folder'), { target: { value: '/tmp/workflow' } })
  fireEvent.click(screen.getByText('Open workflow'))
  await screen.findByText('Vacation sync')
  expect(fetchMock).toHaveBeenCalledWith('/api/workflow/graph?directory=%2Ftmp%2Fworkflow', expect.anything())
  expect(screen.getByText(/Updates from disk every 10 seconds/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^Reload$/ }))
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: /prepare/ }))
  expect(screen.getByText('return 42')).toBeInTheDocument()
  const divider = screen.getByRole('separator', { name: 'Resize query inspector' })
  fireEvent.keyDown(divider, { key: 'ArrowLeft' })
  expect(divider).toHaveAttribute('aria-valuenow', '44')
  fireEvent.click(screen.getByLabelText('Close block details'))
  expect(screen.queryByText('return 42')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Zoom in'))
  await waitFor(() => expect(screen.getByText('1 disconnected blocks')).toBeInTheDocument())
})
