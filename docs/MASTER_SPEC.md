# HYOOL 总纲

> Agent 每次开工只读本文件 + `FEATURES.md` 里对应条目的文件清单。不要通读仓库。

## 1. 项目定位（2026-08-27 重构）

**HYOOL 是什么**：让**零基础、零想法**的普通人，凭正常审美就能做出**可玩、可发布**的作品。AI 辅助起步，**改完立刻试玩**，满意再站内分享。

**能做什么**：视觉小说 / 互动故事（**已可用** `make.html`，含图片镜 + 视频镜 + BGM/配音）、卡牌与 H5 游戏、漫画；（音乐工具在 workspace）。

**两大核心**（用户心智，取代旧「四世界」入口）：

```
HYOOL
├── 创作作品 — 视觉小说(make：图+视频镜) · 漫画/卡牌/H5(专工)
└── 创造世界 — 角色 · 世界 · IP → 创角 / 个人主页 / 幻灵广场 / 素材库
```

**底层五件套**（技术愿景，逐步收敛）：**作品编辑器** + **素材系统** + **世界/IP 系统** + **互动引擎** + **时间轴**。旧四世界（幻想/彼岸/无限/生命）**不删能力**，只改入口与命名；旧入口 → `make.html`。

栈：Cloudflare Workers + D1 + R2 + 静态资源（`public/`）。入口 `src/index.js`。

## 2. 当前阶段

**已完成（小白主路径）**

- **视觉小说 / 互动故事**：`public/make.html` — 镜头列表 + 实时预览 + 试玩 + 发布；**视频镜**（原声播完下一镜）与 **背景视频**（静音循环）按镜头切换；BGM / 配音
- 作品列表 / 删除 / 本地缓存同步修复；`story` 自动进 make，`?pro=1` 进专业编辑器

**下一档**

- 视频时间轴卡点选项、成片导出等（仍归 make 壳，不另开产品）

**专工路径（暂不重构为 make，保留专业编辑器）**

| 类型 | 入口 | 说明 |
|---|---|---|
| 漫画 | `story-editor.html?pro=1&new=comic` | 分格 + 气泡，功能完整，小白可从 make 底栏进入 |
| 卡牌 | `story-editor.html?pro=1&new=card` | gacha_rogue / card_rpg |
| H5 游戏 | `h5-game.html` | 粘贴 playUrl，iframe 试玩发布 |

**仍保留**

- **AI 中枢** `brain.html`、**世界** hub/world、**图片工具** workspace
- 生命引擎细节：从「高级工具 / 创造世界」进入

## 3. 页面结构

| 用户意图 | 页面 |
|---|---|
| 首页 | `public/index.html` → **创作作品** / **创造世界** |
| **视觉小说（主）** | `public/make.html`（`make-video.html` → 重定向） |
| 创作总览 | `public/studio.html` → `make.html` |
| 专业 / 漫画 / 卡牌 | `public/story-editor.html?pro=1` |
| H5 游戏 | `public/h5-game.html` → `h5-play.html` |
| AI 一句话 | `public/brain.html` |
| 账号 / 主页 | `public/yonder.html` → `yonder-home.html` |
| 去玩 | `public/plaza.html` |
| 世界 / 角色 | `public/yonder-home.html`（`/@username`）`studio-world.html` `create.html` `world.html`；旧 `/hub` 仅 302 |
| 图片工具 | `public/workspace.html` |

## 4. 核心设计原则

- 黑色为主、极简；**先懂再深**，默认隐藏高级项
- **商业级底座**：小白填表/积木 → 可发布成品；不接打地鼠类玩具
- **三层模型**（互动作品）：逻辑程序控 / 剧情作者控 / 表现 AI 可选 → 见 `editor-vision.md`
- **分发**：站内消费 + 网页分享；不优先独立包
- **数据分区**：二进制 → R2；D1 存元数据 → `ARCHITECTURE.md`

## 5. 画布

横屏 16:9 / 竖屏 9:16；字段 `orientation`: `landscape` | `portrait`。

## 6. 开发原则

1. `FEATURES.md` 找文件再改
2. 局部修改；旧 URL 重定向，不删 API
3. 改完检查播放 / 主页 / 广场同一 `kind`
4. 大重构分阶段：先入口与文案，再收编辑器 UI

## 7. Agent 原则

读本文件 + `FEATURES.md` 对应行；`src/mvp.js` 只 Grep 路由段。勿读 `archive/`、`vendor/`、`.wrangler/`。

## 8. 文档

| 文件 | 用途 |
|---|---|
| `MASTER_SPEC.md` | 定位、阶段 |
| `FEATURES.md` | 功能 → 文件 |
| `ARCHITECTURE.md` | 请求流 |
| `editor-vision.md` | 编辑器长期地图 |

## 9. 归档

废弃代码入 `archive/`，勿留 `src/`。
