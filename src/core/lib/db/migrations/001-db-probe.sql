-- Явная тестовая миграция, НЕ запускается автоматически приложением.
CREATE SCHEMA IF NOT EXISTS db_probe;
CREATE TABLE IF NOT EXISTS db_probe.author (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
 private_note text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS db_probe.blog (
 id uuid PRIMARY KEY,
 owner_id uuid NOT NULL REFERENCES db_probe.author(id),
 title text NOT NULL CHECK (length(title) BETWEEN 2 AND 200),
 body text NOT NULL DEFAULT '',
 private_note text NOT NULL DEFAULT '',
 score numeric(30,8) NOT NULL DEFAULT 0,
 sequence bigint NOT NULL DEFAULT 0,
 active boolean NOT NULL DEFAULT true,
 tags text[] NOT NULL DEFAULT '{}',
 meta jsonb NOT NULL DEFAULT '{}',
 published_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS db_probe_blog_page ON db_probe.blog (created_at DESC NULLS LAST, id ASC NULLS LAST) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS db_probe_blog_owner ON db_probe.blog (owner_id);
