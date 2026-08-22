-- 个人主页：无限模块 → 自定义模块区
-- yonder_settings 新增 modules 列（JSON 数组：[{id, name, content}]，页面按序渲染）
-- 用法：wrangler d1 execute hyool-db --remote --file=./schema/migrate_yonder_modules.sql
ALTER TABLE yonder_settings ADD COLUMN modules TEXT DEFAULT '[]';
