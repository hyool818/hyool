# HYOOL 总纲

> Agent 每次开工只读本文件 + `FEATURES.md` 里对应条目的文件清单。不要通读仓库。

## 1. 项目定位

HYOOL = 幻想 × 无限 × 生命 × 彼岸（首页四入口）。

核心理念：让用户创造属于自己的作品。

栈：Cloudflare Workers + D1 + 静态资源（`public/`）。入口 `src/index.js`。

## 2. 当前阶段

优先完善：

- **彼岸**：账号、个人主页、我的彼岸（角色/世界）
- **幻想**：作品编辑器、游戏工坊

**无限**（图片/音频工具箱）、**生命**（生命世界/广场）先保留，非任务不要主动改。

## 3. 页面结构

首页 `public/index.html`（世界选择）

- 幻想 → `fantasy.html`（制作总览）→ 作品编辑器 / 游戏工坊
- 彼岸 → `yonder.html` 登录后个人主页 / `hub.html` 我的彼岸
- 无限 → `workspace.html`（工具箱，非本次重点）
- 生命 → `/plaza` 幻灵世界广场、`world.html`（非本次重点）

## 4. 核心设计原则

- 黑色为主、极简、数字世界感
- 不要堆砌功能
- **不随意改变已经确定的视觉设计**
- 图片不上传服务器作「素材库」卖点时：工具类走本地 WASM；作品媒体走现有 `/api/upload` URL 引用

## 5. 当前画布（作品）

用户自选：

- 横屏 1920 × 1080（实现里常用 16:9，标准档约 1280 宽）
- 竖屏 1080 × 1920（9:16）

字段：作品 `orientation`: `landscape` | `portrait`。

## 6. 开发原则

修改前：

1. 先在 `FEATURES.md` 找到文件，再打开
2. 先理解现有逻辑
3. 尽量局部修改
4. 不随意重构
5. 不删除已有功能
6. 改完检查同一数据/状态的相关页面

禁止推翻 `ARCHITECTURE.md` / 本文件已写明的架构决策；要改先问用户。

## 7. Agent 原则

优先读取：

1. 本文件
2. `FEATURES.md` 对应功能一行
3. 必要时再读 `ARCHITECTURE.md` / `DATA_STRUCTURE.md` / `UI_GUIDE.md` 中**相关小节**
4. 清单里的源码（小范围 Grep / 分段 Read）

不要主动读取：

- `archive/`
- `public/workspace/vendor/`
- `.wrangler/`
- `docs/history.md`（除非要查某次改动细节）
- 无关世界的大页（如未涉及生命时不要读 `world.html` / `src/mvp.js` 全文）

`src/mvp.js` 极大：只用 Grep 定位路由再读附近。

## 8. 文档怎么用

| 文件 | 只回答什么 |
|---|---|
| `MASTER_SPEC.md` | 定位、阶段、原则 |
| `FEATURES.md` | 功能 → 文件 / API |
| `ARCHITECTURE.md` | 请求流、模块边界 |
| `DATA_STRUCTURE.md` | 表与 JSON |
| `UI_GUIDE.md` | 视觉与画布 |
| `CHANGELOG.md` | 近期改了什么 |
| `history.md` | 历史长文，按需 |

长文专题（按需）：`editor-vision.md`、`hyool-brain-architecture.md`。

## 9. 归档

废弃代码/实验**不要删、不要留在 `src/`**：放入 `archive/`（见该目录 README）。当前仓库尚无旧版 `src_old_*`。
