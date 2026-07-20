import test from 'node:test'
import assert from 'node:assert/strict'
import { explainSimilarity, inferTags, scoreCatalog, scoreFont } from './search.mjs'

const CATALOG = [
  { family: 'Roboto', category: 'sans serif', description: null, tags: [] },
  { family: 'Roboto Slab', category: 'slab serif', description: null, tags: [] },
  { family: 'Open Sans', category: 'sans serif', description: null, tags: [] },
  { family: 'Fraunces', category: 'display serif', description: 'Characterful contrast for headlines.', tags: [{ tag: 'editorial', confidence: 0.9 }] },
]

test('maps a fintech brief to its semantic tags', () => {
  assert.deepEqual(inferTags('modern trustworthy fintech app'), ['modern', 'trustworthy', 'ui-product'])
})

test('ranks matching tags above unmatched tags', () => {
  const score = scoreFont({ tags: [{ tag: 'modern', confidence: .9 }, { tag: 'trustworthy', confidence: .8 }] }, ['modern', 'trustworthy'])
  assert.ok(score > .8)
})

test('explains feature-led similarity', () => {
  const value = explainSimilarity({ features: { x_height_ratio: .7, aperture: 'open', contrast: 'low' }, tags: [{ tag: 'modern' }] }, { features: { x_height_ratio: .71, aperture: 'open', contrast: 'low' }, tags: [{ tag: 'modern' }] })
  assert.match(value, /x-height/)
})

test('an exact family name search returns only that family, ranked first', () => {
  const results = scoreCatalog(CATALOG, 'Roboto')
  assert.deepEqual(results.map(font => font.family), ['Roboto', 'Roboto Slab'])
  assert.equal(results[0].matchScore, 100)
})

test('a partial family name search still filters out unrelated families', () => {
  const results = scoreCatalog(CATALOG, 'slab')
  assert.deepEqual(results.map(font => font.family), ['Roboto Slab'])
})

test('a query with no name or tag match drops every family instead of returning them all', () => {
  assert.deepEqual(scoreCatalog(CATALOG, 'zzzznotfound'), [])
})

test('name matches outrank tag-inferred matches for the same query', () => {
  const results = scoreCatalog(CATALOG, 'editorial')
  assert.equal(results[0].family, 'Fraunces')
})
