# 功能说明（文件索引）

改某功能时：**只打开「相关文件」**。`src/mvp.js` 用路径字符串 Grep，不要整文件读。

## 彼岸

| 功能 | 页面 | API | 后端 |
|---|---|---|---|
| 注册/登录/会话 | `public/yonder.html` | `/api/register` `/api/login` `/api/logout` `/api/me` | `src/index.js` |
| 个人主页 | `public/yonder-home.html`（`/@username`） | `/api/profile/:username` `/api/yonder/*` | `src/index.js` |
| 主页作品流 | 同上 | 主页组装含 `works.stories` | `src/index.js`（stories 查询） |
| 我的彼岸 | `public/hub.html` `/hub` | `GET /api/hub`（角色列表，**不是** `/api/hub/`） | `src/mvp.js` |
| 邀请码 | yonder / hub 管理 UI | `/api/invite-codes*` | `src/index.js`（仅用户 `333123`） |
| 上传分块图 | 各页 | `POST /api/upload` | `src/index.js` → D1 `images` |

## 幻想 · 作品编辑器

| 功能 | 页面 | API | 说明 |
|---|---|---|---|
| 制作总览 | `public/fantasy.html` | — | 入口卡片 |
| 编辑器 UI | `public/story-editor.html` | — | 样式 + 壳 |
| 编辑器逻辑 | `public/story-editor.js` `public/story-rogue.js` | `/api/stories*` `/api/tts` `/api/upload` | 积木、播放、卡牌RPG、肉鸽卡牌、云同步 |
| 作品 CRUD | — | `GET/POST /api/stories` `GET/PUT /api/stories/:id` `POST .../publish` `POST .../delete` | `src/mvp.js` stories 段 |
| 广场露出 | `public/plaza.html` | `GET /api/plaza` 的 `stories` | 已发布 + `share_id` 非空 |
| 产品愿景 | `docs/editor-vision.md` | — | 仅改长期类型地图时读 |

作品 `kind`：`story` | `card_rpg`（旧互殴）| `gacha_rogue`（女神挂机 / 修仙自动战 / 每局不同）。编辑壳：作品库三步创建 → 剪映式时间线（积木拖排序、文件拖上积木、对白/场景点开行内改字、底栏芯片加块、顶栏常驻试玩）。卡牌工作室：角色/关卡表格 + 行拖排序 + 三步指引。参考样品：`public/story-samples.js`。底座原则：小白积木 → 可上线作品；接水果/打地鼠类已下线且不再加回；`game-studio.html` / `game-workshop.html` 重定向到作品编辑器。不要再拆五个配置弹窗。不要整仓 vendoring GPL 游戏。

## 幻想 · 游戏工坊（已下线）

| 功能 | 文件 | 说明 |
|---|---|---|
| 旧模板页 | `public/game-studio.html` `public/game-workshop.html` | 重定向到 `story-editor.html`；不再作为产品入口 |

## 生命（保留，非任务勿改）

| 功能 | 页面 | API 前缀 | 后端 |
|---|---|---|---|
| 广场 | `public/plaza.html` | `GET /api/plaza` | `src/mvp.js` |
| 生命世界 | `public/world.html` | `/api/worlds` `/api/worlds/:id/life/*` | `src/mvp.js` + `src/ai/gateway.js` 节拍 |
| 后台 tick | — | cron | `handleWorldCron` in `src/mvp.js` |

## 无限（保留，非任务勿改）

| 功能 | 文件 |
|---|---|
| 工具箱 hub | `public/workspace.html` `public/workspace/js/hub.js` `public/workspace/js/app.js` |
| 编解码 | `public/workspace/js/codecs.js` `engine.js` … **不要读 vendor/** |
| 音频工坊 | `public/audio.html` `public/workspace/js/audio.js` |

## 角色与聊天（彼岸相关）

| 功能 | 页面 | API | 后端 |
|---|---|---|---|
| 快速创角 | `public/create.html` | `POST /api/create` | `src/mvp.js` + `src/ai/gateway.js` |
| 高级创角 | `public/create-character.html` | `POST /api/character/create-advanced` | 同上 |
| 对话 | `public/buddy.html` `/buddy/:id` | `/api/buddy/:id/chat` 等 | `src/mvp.js` + gateway |
| Companion | buddy / hub | `/api/companion/inbox*` `/api/buddy/:id/relation` | `src/companion.js` |
| TTS | — | `/api/tts` `/api/tts/voices` | `src/tts.js`（鉴权在 `index.js`） |

## AI 中枢（一句话出作品，前端页未做）

仅改规划/DAG/工具时读：`src/hub/*` + `docs/hyool-brain-architecture.md`。  
路由：`GET /api/hub/meta` `POST /api/hub/plan` `POST /api/hub/run`（`src/hub/index.js`）。  
**不要**把 `/api/hub` 和 `/api/hub/` 搞混。

## 冒烟页（回归用，不是产品）

`public/*-check.html`、`public/smoke-test.html`。改对应功能时才打开。
