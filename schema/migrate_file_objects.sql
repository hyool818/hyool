-- R2 素材元数据（二进制在 R2，D1 只存 r2_key 与引用）
-- Usage: wrangler d1 execute hyool-db --remote --file=./schema/migrate_file_objects.sql

CREATE TABLE IF NOT EXISTS file_objects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    sha256 TEXT,
    scope TEXT DEFAULT 'upload',
    scope_id TEXT,
    category TEXT DEFAULT 'other',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_file_objects_owner ON file_objects(owner_id);
CREATE INDEX IF NOT EXISTS idx_file_objects_r2_key ON file_objects(r2_key);
