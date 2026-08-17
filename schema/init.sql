-- HYOOL 完整建表脚本（一次性执行到 D1）
-- 用法：wrangler d1 execute hyool-db --remote --file=./schema/init.sql
--   或在 Cloudflare Dashboard → D1 → hyool-db → Query 粘贴执行

-- ===== 账户与会话（注册/登录必需）=====
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    theme TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    avatar_url TEXT DEFAULT '',
    background_url TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ===== 彼岸个人主页 =====
CREATE TABLE IF NOT EXISTS yonder_settings (
    user_id TEXT PRIMARY KEY,
    background_type TEXT DEFAULT 'gradient',
    background_value TEXT DEFAULT '',
    accent_color TEXT DEFAULT '#8b8bff',
    layout TEXT DEFAULT 'default',
    show_profile INTEGER DEFAULT 1,
    show_posts INTEGER DEFAULT 1,
    show_works INTEGER DEFAULT 1,
    show_infinite INTEGER DEFAULT 1,
    custom_css TEXT DEFAULT '',
    access_password TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS yonder_posts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    content TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_yonder_posts_user ON yonder_posts(user_id);

-- ===== MVP 核心：角色 / 对话 / 消息 / 记忆 / 资产 =====
CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    appearance TEXT DEFAULT '',
    personality TEXT DEFAULT '',
    background TEXT DEFAULT '',
    speech_style TEXT DEFAULT '',
    world_name TEXT DEFAULT '',
    world_description TEXT DEFAULT '',
    story_hook TEXT DEFAULT '',
    source_idea TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    share_id TEXT UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_characters_owner ON characters(owner_id);
CREATE INDEX IF NOT EXISTS idx_characters_share ON characters(share_id);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(character_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    character_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memories_char_user ON memories(character_id, user_id);

CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    character_id TEXT,
    type TEXT NOT NULL,
    url TEXT DEFAULT '',
    meta_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ===== 图片分块存储（突破 D1 1MB 行限制）=====
CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    total_size INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS image_chunks (
    image_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (image_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_image_chunks ON image_chunks(image_id, chunk_index);
