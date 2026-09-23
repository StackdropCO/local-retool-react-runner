export type CurrentUserGroup = {
  id: number
  name: string
}

export type CurrentUser = {
  id: number
  email: string
  firstName: string
  lastName: string
  fullName: string
  profilePhotoUrl: string | null
  groups: CurrentUserGroup[]
  metadata: Record<string, unknown>
  sid: string
  externalIdentifier: string | null
  locale: string
}

export const DEFAULT_CURRENT_USER: CurrentUser = {
  id: 0,
  email: 'dev@local',
  firstName: 'Local',
  lastName: 'Developer',
  fullName: 'Local Developer',
  profilePhotoUrl: null,
  groups: [],
  metadata: {},
  sid: 'local-dev',
  externalIdentifier: null,
  locale: 'en',
}

export function resolveCurrentUser(value: unknown): CurrentUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return DEFAULT_CURRENT_USER
  const candidate = value as Partial<CurrentUser>
  return {
    ...DEFAULT_CURRENT_USER,
    ...candidate,
    groups: Array.isArray(candidate.groups) ? candidate.groups : [],
    metadata: candidate.metadata && typeof candidate.metadata === 'object' && !Array.isArray(candidate.metadata)
      ? candidate.metadata
      : {},
  }
}

export function parseCurrentUser(value: unknown): CurrentUser {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('currentUser must be a JSON object')
  }
  const candidate = value as Record<string, unknown>
  if (typeof candidate.id !== 'number' || !Number.isFinite(candidate.id)) {
    throw new Error('currentUser.id must be a number')
  }
  if (typeof candidate.email !== 'string' || !candidate.email.trim()) {
    throw new Error('currentUser.email must be a non-empty string')
  }
  if (!Array.isArray(candidate.groups) || candidate.groups.some((group) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return true
    const item = group as Record<string, unknown>
    return typeof item.id !== 'number' || typeof item.name !== 'string' || !item.name.trim()
  })) {
    throw new Error('currentUser.groups must contain { id: number, name: string } objects')
  }
  return resolveCurrentUser(candidate)
}

export const currentUserDeclarationSource = () => `
export type CurrentUserGroup = { id: number; name: string }
export type CurrentUser = {
  id: number
  email: string
  firstName: string
  lastName: string
  fullName: string
  profilePhotoUrl: string | null
  groups: CurrentUserGroup[]
  metadata: Record<string, unknown>
  sid: string
  externalIdentifier: string | null
  locale: string
}
export declare function useCurrentUser(): {
  user: CurrentUser | null
  loading: boolean
  error: string | null
}
`
