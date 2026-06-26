// FakeClickHouse — lightweight in-memory implementation of ClickHouseLike for unit tests.
// Stores SQL→result mappings keyed on the normalized SQL string. Each registered
// handler receives the query_params so tests can assert parameterization.

import type { ClickHouseLike } from '../src/clickhouse.js'

type QueryHandler = (params: Record<string, unknown>) => unknown[]

export class FakeClickHouse implements ClickHouseLike {
  private readonly handlers = new Map<string, QueryHandler>()

  /** Register a handler for queries that include `pattern` as a substring. */
  onQuery(pattern: string, handler: QueryHandler): void {
    this.handlers.set(pattern, handler)
  }

  async query<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
    for (const [pattern, handler] of this.handlers) {
      if (sql.includes(pattern)) {
        return handler(params) as T[]
      }
    }
    throw new Error(`FakeClickHouse: no handler registered for SQL: ${sql}`)
  }

  async close(): Promise<void> {
    // no-op
  }
}
