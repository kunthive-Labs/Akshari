import pg from 'pg'

const { Pool } = pg

export function createDb(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('DATABASE_URL is required. Copy .env.example to .env and configure Postgres.')
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 20_000 })
}

export async function withTransaction(db, work) {
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
