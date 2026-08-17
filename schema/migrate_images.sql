-- Migration: Create images and image_chunks tables for chunked image storage
-- This allows storing images larger than D1's 1MB row limit
-- Usage: wrangler d1 execute hyool-db --remote --file=./schema/migrate_images.sql

CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    total_size INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS image_chunks (
    image_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (image_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_image_chunks ON image_chunks(image_id, chunk_index);
