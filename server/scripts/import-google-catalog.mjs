import { createDb, withTransaction } from '../db.mjs'

const endpoint = 'https://fonts.google.com/metadata/fonts'
const response = await fetch(endpoint, { headers: { 'user-agent': 'Fontscape catalog importer/1.0' } })
if (!response.ok) throw new Error(`Google Fonts catalog request failed with ${response.status}`)
const raw = await response.text()
const catalog = JSON.parse(raw.replace(/^\)\]\}'\s*/, ''))
const families = catalog.familyMetadataList ?? []
if (!families.length) throw new Error('Google Fonts catalog response did not include font families.')

function normalizedWeights(fonts = {}) {
  const values = Array.isArray(fonts) ? fonts : Object.keys(fonts)
  const weights = values.map(value => Number(String(value).match(/^\d+/)?.[0])).filter(Number.isFinite)
  return [...new Set(weights)].sort((a, b) => a - b).filter(weight => weight >= 100 && weight <= 1000)
}

function normalizedStyles(fonts = {}) {
  const values = Array.isArray(fonts) ? fonts : Object.keys(fonts)
  return [...new Set(values.map(value => String(value).includes('i') ? 'italic' : 'normal'))]
}

const db = createDb()
await withTransaction(db, async client => {
  for (const item of families) {
    const family = item.family
    if (!family) continue
    const googleFontsId = family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const weights = normalizedWeights(item.fonts)
    await client.query(`INSERT INTO fonts(family, google_fonts_id, designer, source_url, weights, styles, subsets, category, description)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (google_fonts_id) DO UPDATE SET family = EXCLUDED.family, designer = COALESCE(EXCLUDED.designer, fonts.designer), source_url = EXCLUDED.source_url, weights = EXCLUDED.weights, styles = EXCLUDED.styles, subsets = EXCLUDED.subsets, category = EXCLUDED.category, updated_at = now()`,
      [family, googleFontsId, (item.designers ?? []).join(', ') || null, `https://fonts.google.com/specimen/${encodeURIComponent(family).replace(/%20/g, '+')}`, weights.length ? weights : [400], normalizedStyles(item.fonts), item.subsets?.map(value => value.toLowerCase()) ?? ['latin'], item.category?.replace(/_/g, ' ').toLowerCase() ?? 'unknown', null])
  }
})
console.log(`Imported ${families.length} Google Fonts families.`)
await db.end()
