-- 生命世界线程按访问者隔离：每人只看自己的聊天
-- wrangler d1 execute hyool-db --remote --file=./schema/migrate_world_thread_user.sql
ALTER TABLE world_threads ADD COLUMN user_id TEXT DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_world_threads_world_user ON world_threads(world_id, user_id);
