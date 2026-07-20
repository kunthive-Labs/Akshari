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

// A typed query should be able to find one specific family by name, not just a
// vibe. Exact/prefix/substring hits on the family name rank above tag-based
// scoring so "Roboto" surfaces Roboto, not the entire catalog at a tied score.
function nameMatchScore(family, needle) {
  if (!needle) return 0
  const lower = family.toLowerCase()
  if (lower === needle) return 100
  if (lower.startsWith(needle)) return 96
  if (lower.includes(needle)) return 90
  return 0
}

// The catalog pipeline: filter by explicit tags, then score every remaining
// family against the query - by name match first, then inferred/explicit tags,
// then a plain substring fallback over category/description/tags - and drop
// anything that scores zero once a query is present. Pure and DB-free so the
// browser and the Node/edge server run the exact same logic over the same data.
export function scoreCatalog(fonts, q = '', tags = []) {
  const inferredTags = inferTags(q)
  const normalizedTags = tags.map(tag => tag.toLowerCase())
  const needle = q.trim().toLowerCase()
  const requestedTags = [...inferredTags, ...normalizedTags]

  return fonts
    .filter(font => normalizedTags.every(tag => font.tags.some(item => item.tag === tag)))
    .map(font => {
      if (!needle) {
        const matchScore = requestedTags.length ? Math.round(scoreFont(font, inferredTags, normalizedTags) * 100) : 50
        return { ...font, matchScore }
      }
      const nameScore = nameMatchScore(font.family, needle)
      const tagScore = requestedTags.length ? Math.round(scoreFont(font, inferredTags, normalizedTags) * 100) : 0
      const fieldMatch = !nameScore && [font.category, font.description, ...font.tags.map(tag => tag.tag)].join(' ').toLowerCase().includes(needle)
      return { ...font, matchScore: Math.max(nameScore, tagScore, fieldMatch ? 45 : 0) }
    })
    .filter(font => !needle || font.matchScore > 0)
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
