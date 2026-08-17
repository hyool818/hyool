-- 邀请码系统表结构
-- 执行方式: wrangler d1 execute hyool-db --remote --file=./schema/invite_codes.sql

-- 邀请码表
CREATE TABLE IF NOT EXISTS invite_codes (
    code TEXT PRIMARY KEY,
    created_by TEXT NOT NULL,  -- 创建者用户ID
    max_uses INTEGER,          -- 最大使用次数，NULL表示无限制
    used_count INTEGER DEFAULT 0,  -- 已使用次数
    is_active INTEGER DEFAULT 1,   -- 是否激活，1=激活，0=禁用
    note TEXT DEFAULT '',      -- 备注
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- CSRF令牌表
CREATE TABLE IF NOT EXISTS csrf_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_invite_codes_created_by ON invite_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_invite_codes_is_active ON invite_codes(is_active);
CREATE INDEX IF NOT EXISTS idx_csrf_tokens_user ON csrf_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_csrf_tokens_expires ON csrf_tokens(expires_at);