-- 收费 / 免费作品字段（暂未开通支付，仅数据与展示）
-- characters / worlds 均加：
--   pricing TEXT DEFAULT 'free'   -- free | paid
--   price   INTEGER DEFAULT 0     -- 单位：元（仅 pricing='paid' 时有意义）
-- 用法：wrangler d1 execute hyool-db --remote --file=./schema/migrate_monetization.sql
ALTER TABLE characters ADD COLUMN pricing TEXT DEFAULT 'free';
ALTER TABLE characters ADD COLUMN price INTEGER DEFAULT 0;
ALTER TABLE worlds ADD COLUMN pricing TEXT DEFAULT 'free';
ALTER TABLE worlds ADD COLUMN price INTEGER DEFAULT 0;
