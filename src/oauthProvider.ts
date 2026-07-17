import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'node:http'
import open from 'open'
import { authDir } from './paths.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'

export const CALLBACK_PORT = 8788

export class FileOAuthProvider implements OAuthClientProvider {
  private dir: string
  constructor(host?: string) {
    this.dir = authDir(host)
  }
  private read(f: string): any {
    const p = join(this.dir, f)
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : undefined
  }
  private write(f: string, v: unknown) {
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(join(this.dir, f), JSON.stringify(v, null, 2))
  }
  get redirectUrl() {
    return `http://localhost:${CALLBACK_PORT}/auth/callback`
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'local-mcp-runner',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }
  clientInformation(): OAuthClientInformation | undefined {
    return this.read('client.json')
  }
  saveClientInformation(info: OAuthClientInformationFull) {
    this.write('client.json', info)
  }
  tokens(): OAuthTokens | undefined {
    return this.read('tokens.json')
  }
  saveTokens(tokens: OAuthTokens) {
    this.write('tokens.json', tokens)
  }
  saveCodeVerifier(v: string) {
    this.write('verifier.json', v)
  }
  codeVerifier(): string {
    return this.read('verifier.json')
  }
  async redirectToAuthorization(url: URL) {
    console.log(`[oauth] opening browser to authorize:\n${url.toString()}`)
    await open(url.toString())
  }
}

// Wait for the OAuth redirect on the loopback port and return the `code`.
export function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '', `http://localhost:${CALLBACK_PORT}`)
      const code = u.searchParams.get('code')
      res.setHeader('content-type', 'text/html')
      res.end(code ? 'Authorized. You can close this tab.' : 'No code received.')
      server.close()
      if (code) resolve(code)
      else reject(new Error('no code in callback'))
    })
    server.on('error', reject)
    server.listen(CALLBACK_PORT)
  })
}
