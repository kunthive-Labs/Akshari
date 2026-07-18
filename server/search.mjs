const semanticDictionary = {
  'ai': ['modern', 'technical', 'ui-product'],
  'app': ['ui-product', 'modern'],
  'brand': ['branding', 'elegant'],
  'consumer': ['friendly', 'playful'],
  'developer': ['technical', 'dev-tool'],
  'dev': ['technical', 'dev-tool'],
  'elegant': ['elegant'],
  'editorial': ['editorial', 'display'],
  'fintech': ['trustworthy', 'modern', 'ui-product'],
  'friendly': ['friendly', 'warm'],
  'geometric': ['geometric'],
  'human': ['humanist', 'warm'],
  'luxury': ['luxurious', 'elegant', 'branding'],
  'modern': ['modern'],
  'playful': ['playful', 'friendly', 'rounded'],
  'rounded': ['rounded', 'friendly'],
  'saas': ['modern', 'trustworthy', 'ui-product'],
  'serious': ['serious', 'trustworthy'],
  'technical': ['technical', 'dev-tool'],
  'trust': ['trustworthy'],
  'trustworthy': ['trustworthy'],
  'warm': ['warm', 'friendly'],
}

export function inferTags(query = '') {
  const tokens = query.toLowerCase().match(/[a-z]+/g) ?? []
  return [...new Set(tokens.flatMap(token => semanticDictionary[token] ?? []))]
}

export function scoreFont(font, queryTags = [], explicitTags = []) {
  const requested = [...new Set([...queryTags, ...explicitTags])]
  if (!requested.length) return 0.5
  const tagConfidences = new Map(font.tags.map(tag => [tag.tag, Number(tag.confidence)]))
  const matches = requested.map(tag => tagConfidences.get(tag) ?? 0)
  return matches.reduce((total, confidence) => total + confidence, 0) / requested.length
}

// The catalog pipeline: filter by explicit tags, score every family against the
// query's inferred tags, drop non-matches, and rank. Pure and DB-free so the
// browser and the Node/edge server run the exact same logic over the same data.
export function scoreCatalog(fonts, q = '', tags = []) {
  const inferredTags = inferTags(q)
  const normalizedTags = tags.map(tag => tag.toLowerCase())
  const needle = q.toLowerCase()
  return fonts
    .filter(font => normalizedTags.every(tag => font.tags.some(item => item.tag === tag)))
    .map(font => ({ ...font, matchScore: Math.round(scoreFont(font, inferredTags, normalizedTags) * 100) }))
    .filter(font => !q || font.matchScore > 0 || [font.family, font.category, font.description, ...font.tags.map(tag => tag.tag)].join(' ').toLowerCase().includes(needle))
    .sort((a, b) => b.matchScore - a.matchScore || a.family.localeCompare(b.family))
}

export function searchCatalog(fonts, { q = '', tags = [], limit = 48, offset = 0 } = {}) {
  const scored = scoreCatalog(fonts, q, tags)
  const safeLimit = Math.min(Math.max(Number(limit) || 48, 1), 100)
  const safeOffset = Math.max(Number(offset) || 0, 0)
  return { total: scored.length, offset: safeOffset, limit: safeLimit, fonts: scored.slice(safeOffset, safeOffset + safeLimit) }
}

export function explainSimilarity(source, candidate) {
  const facts = []
  if (source.features?.x_height_ratio && candidate.features?.x_height_ratio && Math.abs(source.features.x_height_ratio - candidate.features.x_height_ratio) < 0.035) facts.push('similar x-height')
  if (source.features?.aperture && source.features.aperture === candidate.features?.aperture) facts.push(`${source.features.aperture} apertures`)
  if (source.features?.contrast && source.features.contrast === candidate.features?.contrast) facts.push(`${source.features.contrast} contrast`)
  const sharedTag = source.tags.find(tag => candidate.tags.some(other => other.tag === tag.tag))?.tag
  if (sharedTag) facts.push(`shared ${sharedTag} character`)
  return facts.length ? `${facts.slice(0, 2).join(' and ')}, with a different visual voice.` : 'Comparable proportions and a related design intent.'
}
