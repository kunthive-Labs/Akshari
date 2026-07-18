import test from 'node:test'
import assert from 'node:assert/strict'
import { explainSimilarity, inferTags, scoreFont } from './search.mjs'

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
