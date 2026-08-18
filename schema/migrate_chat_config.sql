-- Migration: add chat_config and intimacy to characters
-- Run once on your D1 database:
--   wrangler d1 execute hyool-db --file=schema/migrate_chat_config.sql

ALTER TABLE characters ADD COLUMN chat_config TEXT NOT NULL DEFAULT '{"temperature":0.9,"max_tokens":800,"proactivity":"balanced"}';
ALTER TABLE characters ADD COLUMN intimacy     INTEGER NOT NULL DEFAULT 0;
