import Fastify from 'fastify'
import cors from '@fastify/cors'
import { createDb } from './db.mjs'
import { createErrorReporter } from './observability.mjs'
import { getFont, getPreset, getSimilarFonts, listPresets, searchFonts } from './repository.mjs'
import { inferTags } from './search.mjs'

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 32 * 1024,
  trustProxy: Number(process.env.TRUST_PROXY_HOPS ?? 1),
  genReqId: request => request.headers['x-request-id'] || crypto.randomUUID(),
})
const db = createDb()
const reportError = createErrorReporter()
const rateWindows = new Map()
const rateLimit = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 180)
const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map(value => value.trim()).filter(Boolean)

await app.register(cors, {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
    return callback(new Error('Origin is not allowed'), false)
  },
  methods: ['GET', 'POST'],
  maxAge: 86400,
})

app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/')) return
  const now = Date.now()
  const key = request.ip
  const windowStart = now - 60_000
  const requests = (rateWindows.get(key) ?? []).filter(timestamp => timestamp > windowStart)
  if (requests.length >= rateLimit) return reply.code(429).header('retry-after', '60').send({ error: 'RATE_LIMITED', message: 'Too many requests. Please try again in a minute.' })
  requests.push(now)
  rateWindows.set(key, requests)
})

app.addHook('onSend', async (_request, reply, payload) => {
  reply.header('x-content-type-options', 'nosniff')
  reply.header('x-frame-options', 'DENY')
  reply.header('referrer-policy', 'strict-origin-when-cross-origin')
  reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  return payload
})

const healthHandler = async () => {
  await db.query('SELECT 1')
  return { status: 'ok', service: 'fontscape-api' }
}
app.get('/health', healthHandler)
app.get('/api/health', healthHandler)
app.get('/health/live', async () => ({ status: 'ok', service: 'fontscape-api' }))
app.get('/health/ready', healthHandler)

function queryOptions(query) {
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 240) : ''
  const tags = typeof query.tags === 'string' ? query.tags.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => /^[a-z-]{1,48}$/.test(tag)).slice(0, 12) : []
  const limit = Math.min(Math.max(Number(query.limit) || 48, 1), 100)
  const offset = Math.min(Math.max(Number(query.offset) || 0, 0), 10_000)
  return { q, tags, limit, offset }
}

async function catalogHandler(request, reply) {
  const options = queryOptions(request.query)
  reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300')
  return searchFonts(db, options)
}
app.get('/api/fonts', catalogHandler)

app.get('/api/search', async (request, reply) => {
  const options = queryOptions(request.query)
  reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300')
  return { query: options.q, inferredTags: inferTags(options.q), ...(await searchFonts(db, options)) }
})

app.get('/api/fonts/:id', async (request, reply) => {
  const font = await getFont(db, request.params.id)
  if (!font) return reply.code(404).send({ error: 'FONT_NOT_FOUND', message: 'The requested font was not found.' })
  return font
})

async function similarHandler(request, reply) {
  const result = await getSimilarFonts(db, request.params.id, request.query.limit)
  if (!result) return reply.code(404).send({ error: 'FONT_NOT_FOUND', message: 'The requested font was not found.' })
  return result
}
app.get('/api/fonts/:id/similar', similarHandler)
app.get('/api/similar/:id', similarHandler)

app.get('/api/presets', async () => ({ presets: await listPresets(db) }))
app.get('/api/presets/:id', async (request, reply) => {
  const preset = await getPreset(db, request.params.id)
  if (!preset) return reply.code(404).send({ error: 'PRESET_NOT_FOUND', message: 'The requested preset was not found.' })
  return preset
})

app.post('/api/compare', async (request, reply) => {
  const ids = request.body?.ids
  if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4) return reply.code(400).send({ error: 'INVALID_COMPARISON', message: 'Choose between 2 and 4 fonts.' })
  const fonts = (await Promise.all(ids.map(id => getFont(db, id)))).filter(Boolean)
  if (fonts.length !== ids.length) return reply.code(404).send({ error: 'FONT_NOT_FOUND', message: 'One or more selected fonts were not found.' })
  return { fonts }
})

app.get('/api/fonts/:id/export', async (request, reply) => {
  const font = await getFont(db, request.params.id)
  if (!font) return reply.code(404).send({ error: 'FONT_NOT_FOUND', message: 'The requested font was not found.' })
  const format = request.query.format ?? 'json'
  const payload = { family: font.family, weights: font.weights, tags: font.tags.map(tag => tag.tag), googleFontsId: font.googleFontsId }
  if (format === 'css') return { format, value: `@import url('https://fonts.googleapis.com/css2?family=${font.family.replaceAll(' ', '+')}:wght@${font.weights.join(';')}&display=swap');\n\n:root { --font-brand: '${font.family}', sans-serif; }` }
  if (format === 'figma') return { format, value: `${font.family}: ${font.weights.join(', ')}` }
  return { format: 'json', value: payload }
})

app.setErrorHandler((error, _request, reply) => {
  reportError(error, _request)
  const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500
  reply.code(statusCode).send({ error: statusCode === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST', message: statusCode === 500 ? 'The service could not complete that request.' : error.message })
})

const cleanup = setInterval(() => {
  const cutoff = Date.now() - 60_000
  for (const [key, requests] of rateWindows) if (!requests.some(timestamp => timestamp > cutoff)) rateWindows.delete(key)
}, 60_000)
cleanup.unref()

const close = async () => { await app.close(); await db.end(); process.exit(0) }
process.on('SIGINT', close); process.on('SIGTERM', close)
await app.listen({ port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? '0.0.0.0' })
