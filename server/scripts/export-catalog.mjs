// Exports the whole catalog from the local Postgres into two static JSON files
// the frontend loads directly: public/fonts.json and public/presets.json.
//
// This is what makes the deployed site work with no API and no database — the
// browser fetches these once and does all filtering, scoring, and pagination
// client-side (see src/App.jsx + server/search.mjs). Re-run it whenever the
// catalog changes:  npm run db:export
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb } from '../db.mjs'
import { listAllFonts } from '../repository.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const db = createDb()

try {
  const fonts = await listAllFonts(db)

  // Presets plus their ordered member font ids, so a consumer can resolve each
  // preset's families against fonts.json without another round trip.
  const presetRows = (await db.query('SELECT id, name, description, tags, sort_order FROM presets ORDER BY sort_order')).rows
  const memberRows = (await db.query('SELECT preset_id, font_id, position FROM preset_fonts ORDER BY preset_id, position')).rows
  const presets = presetRows.map(row => {
    const fontIds = memberRows.filter(member => member.preset_id === row.id).map(member => member.font_id)
    return { id: row.id, name: row.name, description: row.description, tags: row.tags, sortOrder: row.sort_order, fontCount: fontIds.length, fontIds }
  })

  await writeFile(resolve(root, 'public/fonts.json'), `${JSON.stringify(fonts)}\n`)
  await writeFile(resolve(root, 'public/presets.json'), `${JSON.stringify(presets, null, 2)}\n`)
  console.log(`Exported ${fonts.length} fonts and ${presets.length} presets to public/.`)
} finally {
  await db.end()
}
