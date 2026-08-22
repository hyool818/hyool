# hyool

HYOOL — Digital World

Cloudflare Workers + D1 + Static Assets 项目。

## 项目结构

```
hyool/
├── public/                # 静态资源（通过 /public 目录部署，其余目录不暴露）
│   ├── index.html         # 入口页
│   ├── yonder.html        # 彼岸登录 / 注册
│   ├── yonder-home.html   # 个人彼岸主页（通过 /@username 访问）
│   ├── hub.html           # 我的彼岸（角色/世界展示 + 自定义世界向导）
│   ├── create.html        # 快速创角
│   ├── create-character.html  # 高级创角（8 步 + 语音选择）
│   ├── buddy.html         # 角色对话页
│   ├── share.html
│   ├── logo1.png
│   ├── logo.png
│   └── life.mp4
├── src/index.js           # Worker API（注册、登录、彼岸数据）
├── src/mvp.js             # 创角 / 对话 / 语音路由
├── src/ai/gateway.js      # AI 网关（聊天 / 图片）
├── src/tts.js             # TTS 语音
├── schema/                # D1 数据库迁移 SQL
└── wrangler.toml          # Workers / D1 / Assets 配置
```

数据库表（`profiles`、`sessions`、`yonder_posts`、`yonder_settings`）在 Cloudflare D1 中维护，不在本仓库。

## 本地开发

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 本地预览
wrangler dev

# 手动部署
wrangler deploy
```

本地 secrets 可写入 `.dev.vars`（已被 gitignore，不会提交）。

## 推送到 GitHub

```bash
git add .
git commit -m "说明本次改动"
git push origin main
```

## 自动部署（GitHub Actions）

推送到 `main` 分支后会自动执行 `wrangler deploy`（也可在 Actions 页手动 Run workflow）。

首次使用前，在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需 Workers 编辑权限） |

> `account_id` 已写在 `wrangler.toml`，无需单独配置。
> Token 创建路径：Cloudflare Dashboard → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** 模板（权限：Account > Cloudflare Workers Scripts > Edit；Account > Account Settings > Read）。

## 注意事项

- `wrangler.toml` 中的 `database_id` 需与线上 D1 一致，换账号或数据库时要同步修改。
- 推代码不会改动 D1 数据；表结构仍在 Cloudflare 控制台或 `wrangler d1` 中管理。
- 未配置 GitHub Secrets 时，Actions 会失败，可改用本地 `wrangler deploy`。
