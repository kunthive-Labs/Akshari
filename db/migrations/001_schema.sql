CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS fonts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family TEXT NOT NULL UNIQUE,
  google_fonts_id TEXT NOT NULL UNIQUE,
  designer TEXT,
  year SMALLINT,
  license TEXT NOT NULL DEFAULT 'OFL-1.1',
  source_url TEXT NOT NULL,
  preview_url TEXT,
  weights SMALLINT[] NOT NULL DEFAULT ARRAY[400],
  styles TEXT[] NOT NULL DEFAULT ARRAY['normal'],
  subsets TEXT[] NOT NULL DEFAULT ARRAY['latin'],
  category TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS font_features (
  font_id UUID PRIMARY KEY REFERENCES fonts(id) ON DELETE CASCADE,
  x_height_ratio NUMERIC(4,3),
  cap_height_ratio NUMERIC(4,3),
  contrast TEXT CHECK (contrast IN ('low', 'medium', 'high')),
  aperture TEXT CHECK (aperture IN ('closed', 'medium', 'open')),
  width_class TEXT CHECK (width_class IN ('condensed', 'normal', 'wide')),
  serif_style TEXT,
  average_width NUMERIC(5,3),
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS font_tags (
  font_id UUID NOT NULL REFERENCES fonts(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  tag_version TEXT NOT NULL DEFAULT 'v1',
  source TEXT NOT NULL DEFAULT 'pipeline' CHECK (source IN ('pipeline', 'curated', 'manual')),
  PRIMARY KEY (font_id, tag, tag_version)
);

CREATE TABLE IF NOT EXISTS font_embeddings (
  font_id UUID NOT NULL REFERENCES fonts(id) ON DELETE CASCADE,
  embedding_type TEXT NOT NULL CHECK (embedding_type IN ('visual', 'semantic', 'geometry')),
  embedding vector(512) NOT NULL,
  embedding_version TEXT NOT NULL DEFAULT 'v1',
  PRIMARY KEY (font_id, embedding_type, embedding_version)
);

CREATE INDEX IF NOT EXISTS fonts_family_trgm ON fonts USING gin (family gin_trgm_ops);
CREATE INDEX IF NOT EXISTS font_tags_tag ON font_tags(tag);
CREATE INDEX IF NOT EXISTS font_embeddings_vector ON font_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  sort_order SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS preset_fonts (
  preset_id TEXT NOT NULL REFERENCES presets(id) ON DELETE CASCADE,
  font_id UUID NOT NULL REFERENCES fonts(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL,
  rationale TEXT NOT NULL,
  PRIMARY KEY (preset_id, font_id)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS boards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  font_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
