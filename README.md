# hyool

HYOOL — Digital World

Cloudflare Workers + D1 + Static Assets 项目。

## 项目结构

```
hyool/
├── src/index.js        # Worker API（注册、登录、彼岸数据）
├── wrangler.toml       # Workers / D1 / Assets 配置
├── index.html          # 入口页
├── yonder.html         # 彼岸登录 / 注册
├── yonder-home.html    # 个人彼岸主页（通过 /@username 访问）
├── logo1.png
├── logo.png
└── life.mp4
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

推送到 `main` 分支后会自动执行 `wrangler deploy`。

首次使用前，在 GitHub 仓库 **Settings → Secrets and variables → Actions** 中添加：

| Secret | 说明 |
|--------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token（需 Workers 编辑权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |

Token 创建路径：Cloudflare Dashboard → My Profile → API Tokens → Create Token → Edit Cloudflare Workers 模板。

## 注意事项

- `wrangler.toml` 中的 `database_id` 需与线上 D1 一致，换账号或数据库时要同步修改。
- 推代码不会改动 D1 数据；表结构仍在 Cloudflare 控制台或 `wrangler d1` 中管理。
- 未配置 GitHub Secrets 时，Actions 会失败，可改用本地 `wrangler deploy`。
