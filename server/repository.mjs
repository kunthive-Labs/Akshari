import { explainSimilarity, scoreCatalog, searchCatalog } from './search.mjs'

const detailQuery = `
  SELECT f.*, COALESCE(json_agg(DISTINCT jsonb_build_object('tag', ft.tag, 'confidence', ft.confidence))
    FILTER (WHERE ft.tag IS NOT NULL), '[]') AS tags,
    jsonb_build_object('x_height_ratio', ff.x_height_ratio, 'cap_height_ratio', ff.cap_height_ratio,
      'contrast', ff.contrast, 'aperture', ff.aperture, 'width_class', ff.width_class,
      'serif_style', ff.serif_style, 'average_width', ff.average_width) AS features
  FROM fonts f
  LEFT JOIN font_tags ft ON ft.font_id = f.id AND ft.tag_version = 'v1'
  LEFT JOIN font_features ff ON ff.font_id = f.id
`

function mapFont(row) {
  return {
    id: row.id, family: row.family, googleFontsId: row.google_fonts_id, designer: row.designer,
    year: row.year, license: row.license, sourceUrl: row.source_url, previewUrl: row.preview_url,
    weights: row.weights, styles: row.styles, subsets: row.subsets, category: row.category,
    description: row.description, tags: row.tags ?? [], features: row.features ?? {},
  }
}

// Raw catalog, one row per family, mapped but unscored. This is what the static
// export (public/fonts.json) ships so the browser can score it client-side.
export async function listAllFonts(db) {
  const result = await db.query(`${detailQuery} GROUP BY f.id, ff.font_id ORDER BY f.family`)
  return result.rows.map(mapFont)
}

export async function listFonts(db, { q = '', tags = [], limit = 36 } = {}) {
  const result = await db.query(`${detailQuery} GROUP BY f.id, ff.font_id ORDER BY f.family LIMIT $1`, [Math.min(Number(limit) || 36, 3000)])
  return scoreCatalog(result.rows.map(mapFont), q, tags)
}

export async function searchFonts(db, { q = '', tags = [], limit = 48, offset = 0 } = {}) {
  const result = await db.query(`${detailQuery} GROUP BY f.id, ff.font_id ORDER BY f.family LIMIT 3000`)
  return searchCatalog(result.rows.map(mapFont), { q, tags, limit, offset })
}

export async function getFont(db, id) {
  const result = await db.query(`${detailQuery} WHERE f.id = $1 OR f.google_fonts_id = $1 GROUP BY f.id, ff.font_id`, [id])
  return result.rowCount ? mapFont(result.rows[0]) : null
}

export async function getSimilarFonts(db, id, limit = 8) {
  const source = await getFont(db, id)
  if (!source) return null
  const candidates = await listFonts(db, { limit: 100 })
  const similar = candidates.filter(font => font.id !== source.id).map(font => {
    const sourceTags = new Set(source.tags.map(tag => tag.tag))
    const sharedTags = font.tags.filter(tag => sourceTags.has(tag.tag)).length
    const xDiff = Math.abs(Number(source.features.x_height_ratio ?? .6) - Number(font.features.x_height_ratio ?? .6))
    const score = Math.max(0, Math.min(100, Math.round(45 + sharedTags * 12 + (1 - xDiff / .18) * 24)))
    return { ...font, similarity: score, rationale: explainSimilarity(source, font) }
  }).sort((a, b) => b.similarity - a.similarity).slice(0, Math.min(Number(limit) || 8, 16))
  return { source, similar }
}

export async function listPresets(db) {
  const result = await db.query(`SELECT p.*, COUNT(pf.font_id)::int AS font_count FROM presets p LEFT JOIN preset_fonts pf ON pf.preset_id = p.id GROUP BY p.id ORDER BY p.sort_order`)
  return result.rows.map(row => ({ id: row.id, name: row.name, description: row.description, tags: row.tags, fontCount: row.font_count }))
}

export async function getPreset(db, id) {
  const preset = await db.query('SELECT * FROM presets WHERE id = $1', [id])
  if (!preset.rowCount) return null
  const fonts = await db.query(`${detailQuery} INNER JOIN preset_fonts pf ON pf.font_id = f.id WHERE pf.preset_id = $1 GROUP BY f.id, ff.font_id, pf.position ORDER BY pf.position`, [id])
  return { ...preset.rows[0], fonts: fonts.rows.map(mapFont) }
}
