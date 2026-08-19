-- Migration: Add background_region column to yonder_settings
-- Usage: wrangler d1 execute hyool-db --remote --file=./schema/migrate_background_region.sql
-- （保存设置时也会自动执行 ALTER，此文件用于手动迁移/文档）

ALTER TABLE yonder_settings ADD COLUMN background_region TEXT DEFAULT '';
