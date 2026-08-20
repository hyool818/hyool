-- 对话超长自动摘要支持
-- conversations 增加两列：
--   summary: 已压缩的对话摘要（历次合并）
--   summarized_upto: 已被摘要覆盖的旧消息条数（从最早消息算起，最近 12 条永不摘要）
ALTER TABLE conversations ADD COLUMN summary TEXT DEFAULT '';
ALTER TABLE conversations ADD COLUMN summarized_upto INTEGER DEFAULT 0;