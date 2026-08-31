export const RETOOL_ENVIRONMENTS = ['staging', 'production'] as const

export type RetoolEnvironment = typeof RETOOL_ENVIRONMENTS[number]

export function parseRetoolEnvironment(value: unknown): RetoolEnvironment {
  const name = String(value ?? '').trim() || 'staging'
  if ((RETOOL_ENVIRONMENTS as readonly string[]).includes(name)) return name as RetoolEnvironment
  throw new Error(`invalid environment "${name}"; expected staging or production`)
}
