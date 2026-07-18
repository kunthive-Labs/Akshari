// Cloudflare Pages Function: the Fontscape API, running on Cloudflare's edge.
//
// It reuses the exact query + scoring logic from the Node server
// (server/repository.mjs, server/search.mjs) so behaviour matches local dev.
// The only swap is the database client: node-postgres (Fastify) becomes the
// Neon serverless HTTP driver here, which speaks Postgres over fetch and so
// runs inside the Workers runtime.
//
// Configure one variable in the Pages project:
//   Settings > Variables and Secrets > DATABASE_URL = <your Neon connection string>
//
// Local dev is unaffected: `npm run dev:api` still runs the Fastify server
// against Docker Postgres; only production traffic hits this Function.
import { neon } from '@neondatabase/serverless'
import { getFont, getPreset, getSimilarFonts, listPresets, searchFonts } from '../../server/repository.mjs'
import { inferTags } from '../../server/search.mjs'

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

function json(data, { status = 200, headers = {} } = {}) {
  return Response.json(data, { status, headers: { ...SECURITY, ...headers } })
}
function fail(status, error, message) {
  return json({ error, message }, { status })
}

// Adapt the Neon HTTP client to the { rows, rowCount } shape repository.mjs expects.
function createDb(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')
  const sql = neon(env.DATABASE_URL)
  return {
    query: async (text, params = []) => {
      const rows = await sql.query(text, params)
      return { rows, rowCount: rows.length }
    },
  }
}

function queryOptions(params) {
  const q = (params.get('q') ?? '').trim().slice(0, 240)
  const tags = (params.get('tags') ?? '')
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(tag => /^[a-z-]{1,48}$/.test(tag))
    .slice(0, 12)
  const limit = Math.min(Math.max(Number(params.get('limit')) || 48, 1), 100)
  const offset = Math.min(Math.max(Number(params.get('offset')) || 0, 0), 10_000)
  return { q, tags, limit, offset }
}

const CACHE = { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' }

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api/, '') || '/'
  const method = request.method
  const params = url.searchParams
  let match

  try {
    const db = createDb(env)

    if (method === 'GET' && (path === '/' || path === '/health')) {
      await db.query('SELECT 1')
      return json({ status: 'ok', service: 'fontscape-api' })
    }

    if (method === 'GET' && path === '/fonts') {
      return json(await searchFonts(db, queryOptions(params)), { headers: CACHE })
    }

    if (method === 'GET' && path === '/search') {
      const options = queryOptions(params)
      return json({ query: options.q, inferredTags: inferTags(options.q), ...(await searchFonts(db, options)) }, { headers: CACHE })
    }

    if (method === 'GET' && (match = path.match(/^\/(?:fonts|similar)\/([^/]+)\/similar$/) || path.match(/^\/similar\/([^/]+)$/))) {
      const result = await getSimilarFonts(db, decodeURIComponent(match[1]), params.get('limit'))
      return result ? json(result) : fail(404, 'FONT_NOT_FOUND', 'The requested font was not found.')
    }

    if (method === 'GET' && (match = path.match(/^\/fonts\/([^/]+)\/export$/))) {
      const font = await getFont(db, decodeURIComponent(match[1]))
      if (!font) return fail(404, 'FONT_NOT_FOUND', 'The requested font was not found.')
      const format = params.get('format') ?? 'json'
      if (format === 'css') return json({ format, value: `@import url('https://fonts.googleapis.com/css2?family=${font.family.replaceAll(' ', '+')}:wght@${font.weights.join(';')}&display=swap');\n\n:root { --font-brand: '${font.family}', sans-serif; }` })
      if (format === 'figma') return json({ format, value: `${font.family}: ${font.weights.join(', ')}` })
      return json({ format: 'json', value: { family: font.family, weights: font.weights, tags: font.tags.map(tag => tag.tag), googleFontsId: font.googleFontsId } })
    }

    if (method === 'GET' && (match = path.match(/^\/fonts\/([^/]+)$/))) {
      const font = await getFont(db, decodeURIComponent(match[1]))
      return font ? json(font) : fail(404, 'FONT_NOT_FOUND', 'The requested font was not found.')
    }

    if (method === 'GET' && path === '/presets') {
      return json({ presets: await listPresets(db) })
    }

    if (method === 'GET' && (match = path.match(/^\/presets\/([^/]+)$/))) {
      const preset = await getPreset(db, decodeURIComponent(match[1]))
      return preset ? json(preset) : fail(404, 'PRESET_NOT_FOUND', 'The requested preset was not found.')
    }

    if (method === 'POST' && path === '/compare') {
      const body = await request.json().catch(() => ({}))
      const ids = body?.ids
      if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4) return fail(400, 'INVALID_COMPARISON', 'Choose between 2 and 4 fonts.')
      const fonts = (await Promise.all(ids.map(id => getFont(db, id)))).filter(Boolean)
      if (fonts.length !== ids.length) return fail(404, 'FONT_NOT_FOUND', 'One or more selected fonts were not found.')
      return json({ fonts })
    }

    return fail(404, 'NOT_FOUND', 'Unknown endpoint.')
  } catch (error) {
    return fail(500, 'INTERNAL_ERROR', 'The service could not complete that request.')
  }
}
