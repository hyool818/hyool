-- Migration: Create stories table for story editor works (作品编辑器 · 云端作品)
-- A story is a JSON document produced by /story-editor (文字剧情积木): chapters → blocks.
-- data 列保存完整作品 JSON（chapters/cast/orientation/imgQuality），跨设备同步。
-- cover_image 从 data 首张 scene 图自动提取，用于个人主页 / 幻灵世界广场卡片。
-- status: draft / published（发布 = 进入幻灵世界广场）；share_id: 主页显示控制（NULL=隐藏）。
-- Usage: wrangler d1 execute hyool-db --remote --file=./schema/migrate_stories.sql

CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    title TEXT NOT NULL,
    data TEXT DEFAULT '{}',
    cover_image TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',          -- draft / published
    share_id TEXT UNIQUE,                 -- NULL=主页隐藏（UNIQUE 约束下隐藏一律置 NULL）
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stories_owner ON stories(owner_id);
CREATE INDEX IF NOT EXISTS idx_stories_share ON stories(share_id);
