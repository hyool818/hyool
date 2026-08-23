-- Migration: 隐藏作品用 share_id = NULL 而非空串
-- 原因：characters.share_id / worlds.share_id 列有 UNIQUE 约束（schema/init.sql、migrate_worlds.sql），
--       空串 '' 在 SQLite UNIQUE 约束下全表只能有一行。此前「隐藏」逻辑写 ''，
--       一旦已有任意一个隐藏角色/世界，再隐藏第二个就报 UNIQUE constraint failed。
--       修复后隐藏一律写 NULL（SQLite UNIQUE 允许多个 NULL），公开判定统一按「非空」过滤，语义不变。
-- 本迁移把存量 share_id='' 的行更新为 NULL（幂等，可重复执行）。
-- 用法：wrangler d1 execute hyool-db --remote --file=./schema/migrate_share_null.sql

UPDATE characters SET share_id = NULL WHERE share_id = '';
UPDATE worlds      SET share_id = NULL WHERE share_id = '';
