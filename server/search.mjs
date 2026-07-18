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

export function explainSimilarity(source, candidate) {
  const facts = []
  if (source.features?.x_height_ratio && candidate.features?.x_height_ratio && Math.abs(source.features.x_height_ratio - candidate.features.x_height_ratio) < 0.035) facts.push('similar x-height')
  if (source.features?.aperture && source.features.aperture === candidate.features?.aperture) facts.push(`${source.features.aperture} apertures`)
  if (source.features?.contrast && source.features.contrast === candidate.features?.contrast) facts.push(`${source.features.contrast} contrast`)
  const sharedTag = source.tags.find(tag => candidate.tags.some(other => other.tag === tag.tag))?.tag
  if (sharedTag) facts.push(`shared ${sharedTag} character`)
  return facts.length ? `${facts.slice(0, 2).join(' and ')}, with a different visual voice.` : 'Comparable proportions and a related design intent.'
}
