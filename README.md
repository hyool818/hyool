# hyool

HYOOL — Digital World

Cloudflare Workers + D1 + Static Assets 项目。

## 文档（给人和 Agent）

不要通读仓库。按任务打开：

| 文件 | 用途 |
|---|---|
| [docs/MASTER_SPEC.md](docs/MASTER_SPEC.md) | 总纲（必读） |
| [docs/FEATURES.md](docs/FEATURES.md) | 功能 → 文件 / API |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构边界 |
| [docs/DATA_STRUCTURE.md](docs/DATA_STRUCTURE.md) | 表与 JSON |
| [docs/UI_GUIDE.md](docs/UI_GUIDE.md) | 视觉与画布 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 近期改动 |

废弃代码进 `archive/`，不要放在 `src/`。

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
├── docs/                  # 总纲与分册（Agent 按任务读）
├── archive/               # 废弃/实验，不参与日常搜索
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

本地 secrets 可写入 `.dev.vars`（已被 gitignore，不会提交）。示例见 `.dev.vars.example`。

### DeepSeek（小说生成 / 镜头提取）

Key **不要**写进仓库、不要发到聊天里。线上用 Cloudflare Secret：

```bash
npx wrangler secret put DEEPSEEK_API_KEY
```

（终端提示后粘贴 Key，回车。）可选：

```bash
npx wrangler secret put DEEPSEEK_BASE_URL   # 默认 https://api.deepseek.com
npx wrangler secret put DEEPSEEK_MODEL      # 默认 deepseek-chat
```

本地开发在 `.dev.vars` 写：

```
DEEPSEEK_API_KEY=sk-你的密钥
```

配置后，`make` 页「AI 写小说 / 提取镜头」会优先走 DeepSeek；未配置则回退 Workers AI。

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
