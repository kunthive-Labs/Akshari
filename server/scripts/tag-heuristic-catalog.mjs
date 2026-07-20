// Fills in semantic tags for every catalog font that doesn't already have any
// (the site ships with only a handful of hand-curated demo fonts tagged - see
// public/fonts.json). Rather than the Claude vision-tagging pipeline described
// in pipeline/fontscape_pipeline.py (which needs an ANTHROPIC_API_KEY, rendered
// specimens, and a Postgres database this static deployment no longer runs),
// this derives tags deterministically and for free from Google's own font
// metadata endpoint: category/classifications/stroke, per-weight stroke
// thickness and width, semantically-named variable-font axes (CASL, SOFT,
// WONK, ...), and family-name patterns. It only ever writes tags from the
// fixed vocabulary in pipeline/config/tags.v1.json, so results stay compatible
// with the inferTags() dictionary in server/search.mjs.
//
// Deliberately conservative: fonts with no real signal are left untagged
// rather than guessed at, and every tag records source: 'heuristic' so it's
// distinguishable from the hand-curated ("curated") demo entries and from any
// future LLM-tagged ("pipeline") pass. Re-run any time with:
//   node server/scripts/tag-heuristic-catalog.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FONTS_JSON = resolve(root, 'public/fonts.json')
const VOCAB_JSON = resolve(root, 'pipeline/config/tags.v1.json')
const MIN_CONFIDENCE = 0.35
const MAX_TAGS = 6

function slugify(family) {
  return family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function fetchGoogleMetadata() {
  const response = await fetch('https://fonts.google.com/metadata/fonts', { headers: { 'user-agent': 'Akshari heuristic tagger/1.0' } })
  if (!response.ok) throw new Error(`Google Fonts metadata request failed with ${response.status}`)
  const raw = await response.text()
  const catalog = JSON.parse(raw.replace(/^\)\]\}'\s*/, ''))
  return new Map((catalog.familyMetadataList ?? []).map(item => [slugify(item.family), item]))
}

// Variable-font axes with a name that itself carries semantic weight (Google's
// registered/proposed axis registry - see fonts.google.com/knowledge/using_type/axis).
const SEMANTIC_AXES = {
  CASL: [['friendly', 0.6], ['playful', 0.5]],
  SOFT: [['rounded', 0.65], ['friendly', 0.55], ['warm', 0.5]],
  WONK: [['playful', 0.6]],
  ROND: [['rounded', 0.65]],
  BNCE: [['playful', 0.55]],
  INFM: [['friendly', 0.5], ['playful', 0.45]],
  CRSV: [['playful', 0.45], ['elegant', 0.35]],
  FLAR: [['playful', 0.4]],
  MONO: [['technical', 0.4]],
}

const NAME_PATTERNS = [
  [/mono|code/i, [['monospace', 0.6], ['technical', 0.55], ['dev-tool', 0.5]]],
  [/slab/i, [['bold', 0.55], ['serious', 0.45], ['classic', 0.4]]],
  [/script|brush|calligraph/i, [['playful', 0.5], ['warm', 0.45], ['friendly', 0.4]]],
  [/display|headline/i, [['display', 0.6]]],
  [/grotesk|grotesque/i, [['grotesk', 0.7], ['modern', 0.45], ['branding', 0.35]]],
  [/geometric|circular/i, [['geometric', 0.65], ['modern', 0.45], ['branding', 0.35]]],
  [/round(ed)?/i, [['rounded', 0.6], ['friendly', 0.4]]],
  [/condensed|narrow|compact/i, [['technical', 0.3]]],
  [/black|heavy|ultra|extrabold/i, [['bold', 0.5]]],
  [/thin|hairline/i, [['elegant', 0.35]]],
  [/retro|vintage|deco\b/i, [['retro', 0.55]]],
  [/future|cyber|space\b/i, [['futuristic', 0.5], ['technical', 0.35]]],
  [/classic|antique|old style/i, [['classic', 0.55]]],
  [/brutal/i, [['brutalist', 0.6]]],
]

function bump(scores, tag, confidence) {
  scores[tag] = Math.max(scores[tag] || 0, confidence)
}

function heuristicTags(family, item, allowedTags) {
  const scores = {}
  const category = (item.category ?? '').toLowerCase()
  const stroke = (item.stroke ?? '').toLowerCase()
  const classifications = new Set((item.classifications ?? []).map(value => value.toLowerCase()))
  const axisTags = new Set((item.axes ?? []).map(axis => axis.tag))
  const weights = item.fonts ?? {}
  const referenceWeight = weights['400'] ?? weights[Object.keys(weights)[0]]

  if (category === 'monospace' || classifications.has('monospace')) {
    bump(scores, 'monospace', 0.85); bump(scores, 'technical', 0.7); bump(scores, 'dev-tool', 0.65)
  }
  if (category === 'display' || classifications.has('display')) {
    // "Display" is a use-case classification (headline/decorative sizing), not
    // a visual-weight judgement - a delicate script face is "display" too, so
    // boldness is left entirely to the thickness/stroke/name signals below.
    bump(scores, 'display', 0.75); bump(scores, 'branding', 0.4)
  }
  if (category === 'handwriting' || classifications.has('handwriting')) {
    bump(scores, 'playful', 0.6); bump(scores, 'friendly', 0.55); bump(scores, 'warm', 0.45)
  }
  if (stroke === 'slab serif') {
    bump(scores, 'bold', 0.5); bump(scores, 'serious', 0.4); bump(scores, 'classic', 0.35)
  } else if (category === 'serif') {
    bump(scores, 'elegant', 0.4); bump(scores, 'editorial', 0.5); bump(scores, 'serious', 0.3)
    if (classifications.has('display')) { bump(scores, 'luxurious', 0.45); bump(scores, 'elegant', 0.55) }
  }
  if (category === 'sans serif' && !classifications.has('display') && !classifications.has('handwriting')) {
    bump(scores, 'ui-product', 0.45)
    bump(scores, 'modern', 0.4)
    bump(scores, 'trustworthy', 0.4)
  }

  if (referenceWeight) {
    if (typeof referenceWeight.thickness === 'number' && referenceWeight.thickness >= 6) bump(scores, 'bold', 0.45)
    if (typeof referenceWeight.thickness === 'number' && referenceWeight.thickness <= 2) bump(scores, 'elegant', 0.3)
    if (typeof referenceWeight.width === 'number' && referenceWeight.width <= 4) bump(scores, 'technical', 0.25)
  }

  for (const [axis, contributions] of Object.entries(SEMANTIC_AXES)) {
    if (axisTags.has(axis)) contributions.forEach(([tag, confidence]) => bump(scores, tag, confidence))
  }
  if (axisTags.has('wght') && axisTags.has('wdth')) bump(scores, 'modern', 0.35)
  if (axisTags.has('opsz')) bump(scores, 'editorial', 0.3)

  for (const [pattern, contributions] of NAME_PATTERNS) {
    if (pattern.test(family)) contributions.forEach(([tag, confidence]) => bump(scores, tag, confidence))
  }

  return Object.entries(scores)
    .filter(([tag, confidence]) => allowedTags.has(tag) && confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TAGS)
    .map(([tag, confidence]) => ({ tag, confidence: Math.round(confidence * 100) / 100, source: 'heuristic' }))
}

const vocab = JSON.parse(await readFile(VOCAB_JSON, 'utf8'))
const allowedTags = new Set(Object.values(vocab.buckets).flat())

const [fonts, metadataBySlug] = await Promise.all([
  readFile(FONTS_JSON, 'utf8').then(JSON.parse),
  fetchGoogleMetadata(),
])

let tagged = 0
let skippedExisting = 0
let noSignal = 0
const frequency = {}

for (const font of fonts) {
  if (font.tags?.length) { skippedExisting++; continue }
  const item = metadataBySlug.get(font.googleFontsId)
  if (!item) continue
  const tags = heuristicTags(font.family, item, allowedTags)
  if (!tags.length) { noSignal++; continue }
  font.tags = tags
  tagged++
  tags.forEach(({ tag }) => { frequency[tag] = (frequency[tag] ?? 0) + 1 })
}

await writeFile(FONTS_JSON, `${JSON.stringify(fonts)}\n`)

console.log(`Tagged ${tagged} fonts (${skippedExisting} already curated, ${noSignal} had no heuristic signal).`)
console.log('Tag frequency:', JSON.stringify(frequency, null, 2))
