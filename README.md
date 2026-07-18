# Fontscape

Fontscape is an open-source semantic typography discovery platform. It helps people find typefaces through mood, visual character, and product context rather than technical metadata alone.

## What is included

- Accessible React discovery interface with a preview sandbox, facet filters, compare tray, export actions, and mobile layout.
- Fastify API for catalog browsing, semantic search, individual font details, similarity, curated presets, comparison, and export.
- PostgreSQL schema using pgvector for image, semantic, and geometric embeddings.
- Repeatable Python pipeline for Google Fonts ingestion, deterministic OpenType metrics, specimen rendering, Claude fixed-vocabulary tagging, CLIP embeddings, and database writes.
- Docker Compose deployment with PostgreSQL + pgvector, API, and Nginx-served frontend.

## Run with Docker

```bash
docker compose up --build
```

Open `http://localhost:3000`. The first API start runs migrations and loads the included starter catalog.

## Public deployment checklist

Use the production override and set real secret values before exposing the service:

```bash
export POSTGRES_PASSWORD='use-a-long-random-secret'
export PUBLIC_ORIGIN='https://fonts.example.com'
export HTTP_PORT=80
docker compose -f compose.yaml -f compose.production.yaml up -d --build
```

Put the web container behind an HTTPS-capable reverse proxy or load balancer. The application includes HTTP security headers, request-size limits, per-IP API throttling, structured logs, live/readiness endpoints, and optional error-webhook reporting via `ERROR_WEBHOOK_URL`.

For multiple API instances, enforce the same rate-limit policy at the reverse proxy or edge provider. The built-in limiter is intentionally process-local so self-hosting works without a separate Redis dependency.

## Run locally

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run db:import-google-fonts
npm run dev:api
npm run dev
```

The web app runs on `http://localhost:5173`; the API runs on `http://localhost:8787`.

To add every currently published Google Fonts family to an existing Docker catalog:

```bash
docker compose exec api npm run db:import-google-fonts
```

The catalog endpoint is paginated. It returns `total`, `offset`, `limit`, and the current `fonts` page. The interface loads 48 specimens at a time to keep performance stable while still making every family reachable.

## API surface

| Endpoint | Purpose |
| --- | --- |
| `GET /api/search?q=&tags=` | Natural-language and facet search |
| `GET /api/fonts` | Catalog browsing |
| `GET /api/fonts/:id` | Font metadata and measurements |
| `GET /api/fonts/:id/similar` | Explainable recommendations |
| `GET /api/presets` | Curated contexts |
| `POST /api/compare` | Comparison payload for 2-4 font ids |
| `GET /api/fonts/:id/export?format=css|figma|json` | Developer and designer exports |

## Pipeline

Create a virtual environment, then install `pipeline/requirements.txt`. The stages are deliberately independent:

```bash
python3 pipeline/fontscape_pipeline.py ingest
python3 pipeline/fontscape_pipeline.py download
python3 pipeline/fontscape_pipeline.py features
python3 pipeline/fontscape_pipeline.py render
python3 pipeline/fontscape_pipeline.py tag
python3 pipeline/fontscape_pipeline.py embed
python3 pipeline/fontscape_pipeline.py write
```

`tag` requires `ANTHROPIC_API_KEY`; `ingest` requires `GOOGLE_FONTS_API_KEY`. Review generated tags against the calibration set before running `write`. `pipeline/config/tags.v1.json` and `pipeline/config/presets.v1.json` are versioned contribution surfaces.

The included `pipeline/calibration/font-tags.v1.json` is the beginning of the manual QA set. Expand it to 100-150 fonts before running a full-catalog tagging job, recording accepted tags and rubric decisions in pull requests.

The `download` stage writes self-hosted font files into `pipeline/fonts`. Docker serves that directory at `/fonts`, and the pipeline `write` stage records those asset URLs for the preview sandbox. A full catalog download is large, so run it in a persistent storage environment and back up the resulting volume.

## Operations

```bash
bash ops/smoke-test.sh
bash ops/backup-db.sh
bash ops/restore-db.sh backups/fontscape-YYYY-MM-DDTHH-MM-SS.dump
```

`/health/live` confirms the API process is running. `/health/ready` verifies database connectivity. GitHub Actions runs the build, unit tests, and Compose smoke test for pull requests and `main`.

## Licensing

The application code is MIT licensed. v1 intentionally uses Google Fonts only. Each included typeface retains its own font license, normally SIL Open Font License 1.1. Do not add commercial or non-OFL fonts without a separate licensing review.
