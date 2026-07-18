import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, withTransaction } from '../db.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const fonts = JSON.parse(await readFile(resolve(root, 'db/seed/fonts.json'), 'utf8'))
const presets = JSON.parse(await readFile(resolve(root, 'db/seed/presets.json'), 'utf8'))
const db = createDb()

function embedding(seed) {
  let value = 2166136261
  const values = []
  for (let i = 0; i < 512; i += 1) {
    for (const character of `${seed}:${i}`) value = Math.imul(value ^ character.charCodeAt(0), 16777619)
    values.push(((value >>> 0) / 4294967295) * 2 - 1)
  }
  return `[${values.join(',')}]`
}

await withTransaction(db, async client => {
  for (const preset of presets) {
    await client.query(`INSERT INTO presets(id, name, description, tags, sort_order) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, tags = EXCLUDED.tags, sort_order = EXCLUDED.sort_order`,
      [preset.id, preset.name, preset.description, preset.tags, preset.sort_order])
  }
  for (const font of fonts) {
    const saved = await client.query(`INSERT INTO fonts(family, google_fonts_id, designer, year, source_url, weights, category, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (google_fonts_id) DO UPDATE SET family = EXCLUDED.family, designer = EXCLUDED.designer, year = EXCLUDED.year, weights = EXCLUDED.weights, category = EXCLUDED.category, description = EXCLUDED.description
      RETURNING id`, [font.family, font.google_fonts_id, font.designer, font.year, `https://fonts.google.com/specimen/${font.family.replaceAll(' ', '+')}`, font.weights, font.category, font.description])
    const id = saved.rows[0].id
    await client.query(`INSERT INTO font_features(font_id, x_height_ratio, cap_height_ratio, contrast, aperture, width_class, serif_style, average_width)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (font_id) DO UPDATE SET x_height_ratio = EXCLUDED.x_height_ratio, cap_height_ratio = EXCLUDED.cap_height_ratio, contrast = EXCLUDED.contrast, aperture = EXCLUDED.aperture, width_class = EXCLUDED.width_class, serif_style = EXCLUDED.serif_style, average_width = EXCLUDED.average_width`,
      [id, font.features.x_height_ratio, font.features.cap_height_ratio, font.features.contrast, font.features.aperture, font.features.width_class, font.features.serif_style ?? null, font.features.average_width])
    await client.query('DELETE FROM font_tags WHERE font_id = $1 AND tag_version = $2', [id, 'v1'])
    for (const tag of font.tags) await client.query('INSERT INTO font_tags(font_id, tag, confidence, tag_version, source) VALUES ($1,$2,$3,$4,$5)', [id, tag, .88, 'v1', 'curated'])
    await client.query(`INSERT INTO font_embeddings(font_id, embedding_type, embedding, embedding_version) VALUES ($1,'geometry',$2,'v1')
      ON CONFLICT (font_id, embedding_type, embedding_version) DO UPDATE SET embedding = EXCLUDED.embedding`, [id, embedding(font.family)])
    await client.query('DELETE FROM preset_fonts WHERE font_id = $1', [id])
    for (const presetId of font.preset_ids) await client.query('INSERT INTO preset_fonts(preset_id, font_id, position, rationale) VALUES ($1,$2,$3,$4)', [presetId, id, 1, font.description])
  }
})

console.log(`Seeded ${fonts.length} fonts and ${presets.length} presets.`)
await db.end()
