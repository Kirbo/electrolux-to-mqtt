import { describe, expect, it, vi } from 'vitest'

// Boundary mock: the real @clickhouse/client needs a live server. The wrapper's job is only
// to forward the SQL + params with JSONEachRow and hand back the parsed rows.
const { createClient, close, query } = vi.hoisted(() => {
  const query = vi.fn(async () => ({ json: async () => [{ total: '3' }] }))
  const close = vi.fn(async () => {})
  const createClient = vi.fn(() => ({ query, close }))
  return { createClient, close, query }
})
vi.mock('@clickhouse/client', () => ({ createClient }))

import { createClickHouseClient } from '../src/clickhouse.js'

describe('createClickHouseClient', () => {
  const config = {
    clickhouseUrl: 'http://ch:8123',
    clickhouseUser: 'reader',
    clickhousePassword: 'pw',
    clickhouseDatabase: 'aptabase',
  }

  it('passes the connection config to the library client', () => {
    createClickHouseClient(config)
    expect(createClient).toHaveBeenCalledWith({
      url: 'http://ch:8123',
      username: 'reader',
      password: 'pw',
      database: 'aptabase',
    })
  })

  it('runs parameterized queries as JSONEachRow and returns the rows', async () => {
    const ch = createClickHouseClient(config)
    const rows = await ch.query<{ total: string }>('SELECT 1 WHERE app_id={app_id:String}', { app_id: 'x' })
    expect(query).toHaveBeenCalledWith({
      query: 'SELECT 1 WHERE app_id={app_id:String}',
      query_params: { app_id: 'x' },
      format: 'JSONEachRow',
    })
    expect(rows).toEqual([{ total: '3' }])
  })

  it('closes the underlying client', async () => {
    await createClickHouseClient(config).close()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
