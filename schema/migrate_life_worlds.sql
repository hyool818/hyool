-- Migration: 生命世界（Living World）——多 AI 角色自主共存的动态世界
-- 用法：wrangler d1 execute hyool-db --remote --file=./schema/migrate_life_worlds.sql
--
-- worlds.world_json 结构：
-- {
--   "background": { "era":"", "place":"", "tone":"", "rule":"", "note":"" },   // 世界背景（后台可设）
--   "natives": [ { "id":"wc_xxx","name":"","appearance":"","personality":"",
--                  "background":"","speech_style":"","avatar":"" } ],           // 世界原住民（只属于本世界）
--   "relations": [ { "a":"char_x|wc_x","b":"","kind":"friend|rival|enemy|family|lover|mentor|neutral","note":"" } ],
--   "scenes": [ { "id":"sc_xxx","name":"","location":"","desc":"","present":[],"opening":"" } ],
--   "life": { "mode":"watch|hybrid|always", "paused":false, "model":"llama3-70b",
--             "tickIntervalSec":25, "cronIntervalMin":40, "cronIntervalMinAway":90,
--             "lastTickAt":0, "ticksToday":0, "tickDay":"", "currentThreadId":"" }
-- }

-- 1) worlds 增加世界数据列
ALTER TABLE worlds ADD COLUMN world_json TEXT DEFAULT '{}';

-- 2) 世界线程（自动 / 场景 / 用户主线）
CREATE TABLE IF NOT EXISTS world_threads (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL,
    kind TEXT DEFAULT 'auto',          -- auto | scene | main
    scene_id TEXT DEFAULT '',
    title TEXT DEFAULT '',
    status TEXT DEFAULT 'active',      -- active | paused | closed
    turn INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_world_threads_world ON world_threads(world_id);

-- 3) 世界消息流（多角色消息，actor 归属）
CREATE TABLE IF NOT EXISTS world_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    seq INTEGER NOT NULL,              -- 线程内递增序号，用于增量拉取
    actor TEXT NOT NULL,               -- char id（wc_/char_）| user | narrator
    name TEXT DEFAULT '',              -- 发言者姓名快照
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_world_messages_thread ON world_messages(thread_id, seq);
