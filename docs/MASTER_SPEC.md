# HYOOL 总纲

> Agent 每次开工只读本文件 + `FEATURES.md` 里对应条目的文件清单。不要通读仓库。

## 1. 项目定位（2026-08-27 重构）

**HYOOL 是什么**：让**零基础、零想法**的普通人，凭正常审美就能做出**可玩、可发布**的作品。AI 辅助起步，**改完立刻试玩**，满意再站内分享。

**能做什么**：视觉小说 / 互动故事、卡牌与 H5 游戏、漫画；（音乐 / 视频 / 动态漫画为工具或筹备中）。

**两大核心**（用户心智，取代旧「四世界」入口）：

```
HYOOL
├── 创作作品 — 故事 · 游戏 · 视觉 → 作品编辑器 / AI 中枢 / H5 工坊
└── 创造世界 — 角色 · 世界 · IP → 创角 / 我的彼岸 / 广场 / 素材库
```

**底层五件套**（技术愿景，逐步收敛）：**作品编辑器** + **素材系统** + **世界/IP 系统** + **互动引擎** + **时间轴**。旧四世界（幻想/彼岸/无限/生命）**不删能力**，只改入口与命名；`fantasy.html` → `studio.html`。

栈：Cloudflare Workers + D1 + R2 + 静态资源（`public/`）。入口 `src/index.js`。

## 2. 当前阶段

优先：

- **创作中枢** `public/studio.html`：统一入口，小白可读
- **作品**：互动小说 / 漫画 / 卡牌 / H5（`stories` + `kind`）
- **世界**：创角、生命世界、个人主页、广场
- **AI 中枢**：一句话 → 企划 → 编辑器

图片工具箱（原无限）、生命引擎细节：保留，从「高级工具 / 创造世界」进入，非首页主叙事。

## 3. 页面结构

| 用户意图 | 页面 |
|---|---|
| 首页 | `public/index.html` → **创作作品** / **创造世界** |
| 创作总览 | `public/studio.html` |
| 作品编辑 | `public/story-editor.html` |
| H5 游戏 | `public/h5-game.html` → `h5-play.html` |
| AI 一句话 | `public/brain.html` |
| 账号 / 主页 | `public/yonder.html` → `yonder-home.html` |
| 去玩 | `public/plaza.html` |
| 世界 / 角色 | `public/hub.html` `create.html` `world.html` |
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
