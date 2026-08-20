-- Migration v2: bring existing remote `worlds` table up to the current schema.
-- v1 (migrate_worlds.sql) used CREATE TABLE IF NOT EXISTS and could not alter
-- an already-existing table that has the old shape (settings_json/style_tags_json/is_public).
-- SQLite ALTER TABLE ADD COLUMN is additive and safe for existing rows.
-- Usage: wrangler d1 execute hyool-db --remote --file=./schema/migrate_worlds_v2.sql

ALTER TABLE worlds ADD COLUMN type TEXT DEFAULT 'story';
ALTER TABLE worlds ADD COLUMN cover_image TEXT DEFAULT '';
ALTER TABLE worlds ADD COLUMN script_json TEXT DEFAULT '[]';
ALTER TABLE worlds ADD COLUMN cast_ids TEXT DEFAULT '[]';
ALTER TABLE worlds ADD COLUMN settings TEXT DEFAULT '{}';
ALTER TABLE worlds ADD COLUMN source_conversation TEXT DEFAULT '';
ALTER TABLE worlds ADD COLUMN status TEXT DEFAULT 'draft';
ALTER TABLE worlds ADD COLUMN share_id TEXT;
