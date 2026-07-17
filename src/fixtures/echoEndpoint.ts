// Mimics an app backend endpoint: reads a global + returns params.
export default async function echoEndpoint(req: { params: any; user: any }) {
  const g = (globalThis as any).fakeResource
  const probe = g ? await g.query('SELECT 1') : null
  return { params: req.params, user: req.user, probe }
}
