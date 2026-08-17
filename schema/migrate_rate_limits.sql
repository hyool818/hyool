-- Migration: Create rate_limits table for IP-based rate limiting
-- Usage: wrangler d1 execute hyool-db --remote --file=./schema/migrate_rate_limits.sql

CREATE TABLE IF NOT EXISTS rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER DEFAULT 1,
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires ON rate_limits(expires_at);
