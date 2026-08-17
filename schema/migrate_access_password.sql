-- Migration: Add access_password column to yonder_settings
-- Usage: wrangler d1 execute hyool-db --remote --file=./schema/migrate_access_password.sql

ALTER TABLE yonder_settings ADD COLUMN access_password TEXT DEFAULT '';
