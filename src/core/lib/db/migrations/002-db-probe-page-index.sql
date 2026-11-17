-- Явное обновление existing fixture, не запускается при startup.
-- На большой production таблице нужен отдельный план CREATE INDEX CONCURRENTLY.
CREATE INDEX IF NOT EXISTS db_probe_blog_page_v2 ON db_probe.blog
 (created_at DESC NULLS LAST, id ASC NULLS LAST) WHERE deleted_at IS NULL;
DROP INDEX IF EXISTS db_probe.db_probe_blog_page;
