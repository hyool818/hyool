# 功能说明（文件索引）

改某功能时：**只打开「相关文件」**。`src/mvp.js` 用路径字符串 Grep，不要整文件读。

## 创作中枢（2026-08-27）

| 功能 | 页面 | 说明 |
|---|---|---|
| 首页双核心 | `public/index.html` | 创作作品 / 创造世界；底部 HYOOL 标语 |
| **主创作应用 · 视觉小说** | `public/make.html` `public/make.js` | 镜头 + 预览 + 试玩 + 发布；图片镜 / **视频镜**（`media.videoMode`: `background` 静音循环 | `clip` 原声播完下一镜）；BGM / 配音 |
| 旧互动视频入口 | `public/make-video.html` | 重定向 → `make.html`（`?hint=video`） |
| 世界/IP | `public/studio-world.html` | 创造世界入口 |
| 旧入口重定向 | `public/studio.html` `public/my-works.html` `public/fantasy.html` | → `/make.html` |
| 漫画 / 卡牌 · 专业 | `public/story-editor.html` `?pro=1` | 分格、卡牌战斗；make 底栏链入 |
| H5 · 专工 | `public/h5-game.html` `h5-play.html` | 嵌入外部游戏 URL |

## 彼岸

| 功能 | 页面 | API | 后端 |
|---|---|---|---|
| 注册/登录/会话 | `public/yonder.html` | `/api/register` `/api/login` `/api/logout` `/api/me` | `src/index.js` |
| 个人主页 | `public/yonder-home.html`（`/@username`） | `/api/profile/:username` `/api/yonder/*` | `src/index.js` |
| 个人主页 · 专属库 | 同上（主人可见） | — | 底栏入口 → `my-vault.html` |
| 主页作品流 | 同上 | 主页组装含 `works.stories` | `src/index.js`（stories 查询） |
| 个人主页 · 角色库 / 世界库 | `public/yonder-home.html` `public/profile-hub-ui.js` `public/profile-hub-modals.html` `public/profile-nav.js` | 主人：创造世界向导、角色编辑、世界详情；`?create=world` `?world=id` | 分享页；访客可见公开角色/世界（聊天权限由主人定，后续） |
| `/hub` 旧书签 | `src/mvp.js` 302 | 登录 → `/@username`；游客 → `/plaza`（**不变**）；`?create=world` → 登录后进向导 | 无 `hub.html` 页面 |
| 角色列表 API | — | `GET /api/hub`（**不是** `/api/hub/` Brain 接口） | `src/mvp.js` |
| 邀请码 | yonder / hub 管理 UI | `/api/invite-codes*` | `src/index.js`（仅用户 `333123`） |
| 上传素材 | 各页 | `POST /api/upload` | `src/assets-storage.js` → R2 + `file_objects`（失败回退 D1 chunks） |
| 我的专属库 | `public/my-vault.html` | `GET /api/my-vault` `DELETE /api/my-vault/:id` | 登录用户云端素材列表与删除（R2 + `file_objects`） |
| 旧图回填 R2 | 管理 | `POST /api/admin/backfill-r2` | 仅 `333123`；把无 `file_objects` 的 `image_chunks` 迁到 R2 |

## 幻想 · 作品编辑器

| 功能 | 页面 | API | 说明 |
|---|---|---|---|
| 制作总览 | `public/fantasy.html` | — | 入口卡片 |
| 编辑器 UI | `public/story-editor.html` | — | HYOOL Studio 五区壳 + **本幕舞台**预览 |
| 编辑器逻辑 | `public/story-editor.js` `public/story-rogue.js` `public/story-idle.js` | `/api/stories*` `/api/tts` `/api/upload` `/api/hub/live-line` | 积木 + 舞台（多立绘/双击改字/缩放/转场）+ choice/perf/变量/分支图/存档、漫画分格、素材库、卡牌、云同步 |
| 作品 CRUD | — | `GET/POST /api/stories` `GET/PUT /api/stories/:id` `POST .../publish` `POST .../delete` | `src/mvp.js` stories 段 |
| 广场露出 | `public/plaza.html` | `GET /api/plaza` 的 `stories` | 已发布 + `share_id` 非空 |
| 产品愿景 | `docs/editor-vision.md` | — | 仅改长期类型地图时读 |

作品 `kind`：`story` | `card_rpg`（旧互殴）| `gacha_rogue`（女神挂机 / 修仙自动战 / 每局不同）| `comic` | `h5_game`（iframe 嵌入外部 H5 构建）。编辑壳：作品库三步创建 → 剪映式时间线（小说）/ 卡牌试玩壳 / 漫画分格 / **H5 工坊**（`h5-game.html`）。**H5**：粘贴 HTTPS 或 `/img/` 游戏地址 → `h5-play.html` 播放；走 stories 发布链，不接打地鼠玩具模板。

## 幻想 · H5 网页游戏

| 功能 | 页面 | API | 说明 |
|---|---|---|---|
| 工坊 | `public/h5-game.html` `public/h5-game.js` | `/api/stories*` `POST /api/upload` | 新建 `kind=h5_game`；填 playUrl / 封面 / 发布 |
| 播放器 | `public/h5-play.html` `public/h5-play.js` | `GET /api/stories/:id` | iframe 嵌入；postMessage `hyool:init` 预留 |

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
| 本机 Comfy 文生图 | `public/comfy-client.js` `public/image-provider.js` `public/comfy-workflows/*`；`scripts/start-comfy-bridge.ps1`；workspace AI 面板 | 浏览器直连；https 线上页经本地桥 `:8443` |

## 本机 ComfyUI 生图（全站）

| 功能 | 页面 / 模块 | 说明 |
|---|---|---|
| 客户端 | `public/comfy-client.js` `public/image-provider.js` | provider=`comfy`\|`pollinations`；工作流 ZIT / krae2 |
| HTTPS 桥 | `scripts/start-comfy-bridge.ps1` `scripts/comfy-bridge.mjs` | mkcert 免费证书；`https://127.0.0.1:8443` → Comfy `:8000` |
| 工作流副本 | `public/comfy-workflows/zit-guofeng.json` `krae2.json` | 来自本机旧/新环境；默认 prompt 已中性化 |
| 创角 / 重绘 | `public/create.html` `public/create-character.html` | comfy 时 `skip_image` → 本地出图 → `/api/upload` → regen `image_url` |
| 封面 | `public/yonder-home.html` `public/world.html` | 封面生成走 image-provider |
| 作品立绘 | `public/story-rogue.js` | 卡牌工作室「本地生图」 |
| API | `POST /api/create` `skip_image`；`POST /api/create/regen-image` 可传 `image_url`；`GET /api/ai/status` 含 `local_comfy` | Workers **不**代理本机 Comfy |

注意：线上 https 页请先开 Comfy(:8000)，再运行 `scripts/start-comfy-bridge.ps1`（证书免费，装一次）。本地 http 开发可直连 `:8000`。桌面 Comfy 默认端口 **8000**；ZIT 与 krae2 需切换对应环境。

## 角色与聊天（彼岸相关）

| 功能 | 页面 | API | 后端 |
|---|---|---|---|
| 快速创角 | `public/create.html` | `POST /api/create` | `src/mvp.js` + `src/ai/gateway.js` |
| 高级创角 | `public/create-character.html` | `POST /api/character/create-advanced` | 同上 |
| 对话 | `public/buddy.html` `/buddy/:id` | `/api/buddy/:id/chat` 等 | `src/mvp.js` + gateway |
| Companion | buddy / hub | `/api/companion/inbox*` `/api/buddy/:id/relation` | `src/companion.js` |
| TTS | — | `/api/tts` `/api/tts/voices` | `src/tts.js`（鉴权在 `index.js`） |

## AI 中枢（一句话出作品）

| 功能 | 页面 | API | 后端 |
|---|---|---|---|
| 中枢页 | `public/brain.html` `public/brain.js` | `/api/hub/meta` `/api/hub/plan` `/api/hub/run` `/api/hub/live-line` | `src/hub/*` |
| 幻想入口 | `public/fantasy.html` | — | 卡片链到 brain |

规划/DAG/工具细节：`docs/hyool-brain-architecture.md`。  
**不要**把 `/api/hub` 和 `/api/hub/` 搞混。

## 作品素材库（本机引用）

| 功能 | 文件 | 说明 |
|---|---|---|
| 库逻辑 | `public/story-assets.js` | `localStorage.hyool_assets_v1`：只存 URL/类型/标签；上传成功自动入库；可粘贴外链 |
| 编辑器入口 | `public/story-editor.html` / `story-editor.js` | 侧栏「素材库」；积木「从素材库选用」画面/配音 |

硬约束：不做「图片上传服务器当素材库卖点」；作品媒体仍走 `/api/upload` URL 引用。

## 冒烟页（回归用，不是产品）

`public/*-check.html`、`public/smoke-test.html`。改对应功能时才打开。
