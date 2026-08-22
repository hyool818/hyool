-- 主页「显示/隐藏」与「发布/下架」解耦（2026-08-23）
-- 主页访客视图的世界过滤从 status='published' 改为 share_id 非空。
-- 存量已发布（status='published'）但 share_id 为空的世界补齐 share_id，
-- 保证它们继续出现在访客主页（默认「显示」态），与「隐藏/显示」语义一致。
-- 幂等：已非空的不再改动，重复执行无害。
UPDATE worlds
SET share_id = 'w' || lower(hex(randomblob(4)))
WHERE status = 'published' AND (share_id IS NULL OR share_id = '');
