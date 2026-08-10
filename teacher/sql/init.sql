-- Extensions the knowledge plane needs. Schema itself is Alembic's job (R1).
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector: dense retrieval
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- trigram: fuzzy title/name match
