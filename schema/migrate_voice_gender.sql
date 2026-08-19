-- Migration: add gender to characters (用于创角时按性别筛选/默认声音)
-- Run once on your D1 database:
--   wrangler d1 execute hyool-db --remote --file=schema/migrate_voice_gender.sql

ALTER TABLE characters ADD COLUMN gender TEXT DEFAULT '';