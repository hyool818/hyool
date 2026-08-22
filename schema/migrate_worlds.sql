-- Migration: Create worlds table for custom worlds (生命世界)
-- A world is a container for a story/game: cast (characters), script JSON,
-- assets (cover/background via AI 生图), settings, and optional source
-- conversation (沉淀自 AI 角色日常沟通).
-- Usage: wrangler d1 execute hyool-db --remote --file=./schema/migrate_worlds.sql

CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    type TEXT DEFAULT 'story',            -- story / vn / game / mixed
    cover_image TEXT DEFAULT '',
    script_json TEXT DEFAULT '[]',        -- 剧本：节点/台词/分歧/素材引用
    cast_ids TEXT DEFAULT '[]',           -- 世界角色 [char_id,...]
    settings TEXT DEFAULT '{}',           -- 世界配置（难度/背景/音效…）
    source_conversation TEXT DEFAULT '',  -- 沉淀来源对话 conv_id
    status TEXT DEFAULT 'draft',          -- draft / published
    share_id TEXT UNIQUE,
    pricing TEXT DEFAULT 'free',          -- free / paid（暂未开通支付）
    price INTEGER DEFAULT 0,              -- 单位：元
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worlds_owner ON worlds(owner_id);
CREATE INDEX IF NOT EXISTS idx_worlds_share ON worlds(share_id);
