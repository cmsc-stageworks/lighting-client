import { getLogger } from '../../logging'

const log = getLogger('thorium.http')

export interface GraphQLResult<T = Record<string, unknown>> {
  data: T | null
  errors?: { message: string }[]
}

export class ThoriumHttp {
  constructor(
    private baseUrl: () => string,
    private clientId: () => string,
    private timeoutMs = 5000
  ) {}

  async request<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<GraphQLResult<T>> {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl()}/graphql`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          clientid: this.clientId()
        },
        body: JSON.stringify({ query, variables }),
        signal: ctrl.signal
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
      const json = (await res.json()) as GraphQLResult<T>
      if (json.errors?.length)
        log.debug(`graphql errors: ${json.errors.map((e) => e.message).join('; ')}`)
      return json
    } finally {
      clearTimeout(t)
    }
  }

  async query<T = Record<string, unknown>>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T | null> {
    const r = await this.request<T>(query, variables)
    return r.data
  }

  async mutate(query: string, variables?: Record<string, unknown>): Promise<void> {
    await this.request(query, variables)
  }
}
