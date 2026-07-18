import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, withTransaction } from '../db.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const migrationDirectory = resolve(root, 'db/migrations')
const db = createDb()

await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
const applied = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map(row => row.name))
const files = (await readdir(migrationDirectory)).filter(name => name.endsWith('.sql')).sort()

for (const name of files) {
  if (applied.has(name)) continue
  const sql = await readFile(resolve(migrationDirectory, name), 'utf8')
  await withTransaction(db, async client => {
    await client.query(sql)
    await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name])
  })
  console.log(`Applied ${name}`)
}

await db.end()
