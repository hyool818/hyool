-- Migration: Companion Engine（数字生命「一对一」层）
-- 情绪状态机 + 关系/家庭生命周期 + 主动找你 inbox
-- 用法：wrangler d1 execute hyool-db --remote --file=./schema/migrate_companion.sql
--
-- characters.companion_state 结构（JSON）：
-- {
--   "emotion":   { "label":"开心", "intensity":2, "updatedAt":"ISO" },
--   "relation":  { "stage":"dating", "manual":true, "since":"ISO", "note":"" },
--   "family":    { "marriedAt":"ISO", "wantedAt":"ISO", "pregnantAt":"ISO",
--                  "pregnant":false, "children":[ {"id":"char_x","name":"","bornAt":"ISO"} ] }
-- }

ALTER TABLE characters ADD COLUMN companion_state TEXT NOT NULL DEFAULT '{}';
ALTER TABLE characters ADD COLUMN parent_id TEXT NOT NULL DEFAULT '';

-- 主动找你（inbox）：角色主动给主人发的消息
CREATE TABLE IF NOT EXISTS companion_inbox (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT '',       -- milestone | miss | anniversary | child
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    read_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_companion_inbox_user ON companion_inbox(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_companion_inbox_char ON companion_inbox(character_id, user_id, created_at);
