# 项目架构

细节实现以源码为准。本文件只定边界和请求流。

## 目录（现行，不要为「整齐」大搬家）

```
hyool/
├─ public/          静态站（Workers Assets）
├─ src/             Worker 源码（正在使用的只有这里）
├─ schema/          D1 SQL 迁移（一次一文件）
├─ docs/            给人和 Agent 的说明
├─ archive/         废弃/实验，默认不搜索
├─ wrangler.toml
└─ CONTEXT.md       已降级为指针，以 docs/ 为准
```

不要新建空的 `assets/`、`data/` 除非真有独立资源目录。图片在 `public/`，业务数据在 D1。

## 请求流

```
fetch (src/index.js)
  ├─ 账号 / 彼岸 / 上传 / TTS 鉴权
  ├─ handleHubRoutes    仅 /api/hub/* （plan/run/meta）
  ├─ handleMvpRoutes    创角、世界、广场、stories、buddy、companion
  └─ env.ASSETS.fetch   public/*
```

Cron：`scheduled` → `handleWorldCron`（生命世界，15 分钟）。

## 模块边界

| 模块 | 路径 | 职责 |
|---|---|---|
| 路由与鉴权 | `src/index.js` | session、彼岸、upload、挂载 hub/mvp |
| MVP API | `src/mvp.js` | 角色/世界/故事/聊天（文件很大） |
| LLM | `src/ai/gateway.js` `src/ai/models.js` | 聊天、创角、世界节拍 |
| Companion | `src/companion.js` | 情绪/关系/家庭：引擎落账，LLM 只演绎 |
| TTS | `src/tts.js` | Edge TTS |
| 中枢 | `src/hub/*` | 一句话 → Blueprint → DAG；落地 story-editor；**不**用 LLM 在运行时决定分支 |

## 作品运行时三层（定案 2026-08-26）

适用于互动小说与卡牌 RPG（剧情驱动 × 卡牌战斗 × 角色关系 × 实时互动）：

| 层 | 谁控制 | 内容 | 运行时 |
|---|---|---|---|
| ① 游戏逻辑 | 100% 程序 | HP、卡牌、印记、好感/关系、战斗结果、剧情变量 | 确定性；可回放 |
| ② 剧情 | 100% 作者积木 | 章节、场景、事件、A/B/C、跳转、`terminal` | `choice` + 变量/条件；**禁止** LLM 选分支 |
| ③ 表现 | 预设为主，AI 可选 | 走路吐槽、战斗口令、好感一句谢 | 只改台词文本；失败 → 预设/静默；**不得**改状态或跳转 |

核心环：`剧情给出选项 → 玩家选择 → 状态落账 → 角色演出`。  
玩家感受应是「角色活着」，不是「我在跟 AI 聊天」。  
与 Companion / 生命世界一致：**引擎落账，LLM 只演绎**。

## 已拍板、不要推翻

- **三层 prompt**：内核（后端固定）/ 内容（角色字段）/ 参数（后端 clamp）
- **LLM 不维护世界/伴侣状态**；状态由确定性代码写 JSON
- **中枢**：LLM 只产企划书，不调工具；素材任务由 `deriveAssets` 派生；运行时不决定分支
- **作品运行时三层**：逻辑程序控 / 剧情作者控 / 表现 AI 可选；AI 不得改状态或跳转
- **作品类型**：同一 `stories` 表 + `kind` 薄壳，不新开编辑器
- **商业级底座**：通用层（素材 / 场景 / 变量 / 事件 / Project State）与模板一律服务「小白 → 可上线作品」；不恢复接水果类玩具模板；新 `kind` 须能走到发布与主页/广场露出
- **分发与消费（2026-08-26）**：站内消费固定；作品以**网页模式分享**（链接 / 广场 / 主页）；不优先独立 ZIP/多端包。远景：个人主页→店、生命市场→市场（可有 App）；当前把 Web 分享与播放做稳，不开 App 分支
- **生命世界 = 故事孵化器**：`world_json.state` 系统维护
- **禁手改** `.wrangler/` 构建产物
- 成人红线：后端不关键词拦截；未成年性内容等红线由模型自判（见历史文档）

## 前端约定

- **无构建步骤**（除 Workers 部署）
- 无限世界编解码：浏览器 WASM，`public/workspace/vendor/` 勿当业务代码改
- 入口：无限 = 工具类；幻想 = 制作类

## 配置

`wrangler.toml`：`ASSETS`、`DB`、`AI`、`VECTORIZE`、`ASSETS_BUCKET`（R2）、cron。Secrets 用 `.dev.vars`（不入库）。

## 数据分区（R2 / D1）— 2026-08-26 定案

**硬规则**：D1 只存元数据与 URL 引用；任何二进制（图片/音频/视频/动图/模型权重）一律进 R2。

| 存储 | 放什么 | 不放什么 |
|------|--------|----------|
| **R2** `ASSETS_BUCKET` | 文件本体：图片、GIF/WebP、MP4/WebM、音频、未来模型/动图二进制 | 用户表、任务状态、业务 JSON |
| **D1** | 用户/会话、作品/角色/世界、任务记录、配置、`file_objects` 元数据（含 R2 key） | `image_chunks.data` 等 BLOB/base64 |

### 现状 → 目标

| 链路 | 现状 | 目标 |
|------|------|------|
| `POST /api/upload` | 文件 → base64 分块 → D1 `image_chunks` | 文件 → R2 `put` → D1 `file_objects` 一行 |
| `GET /img/:id` | 从 D1 拼 chunk 返回 | 查 D1 元数据 → R2 `get`（或 302 到公开域）；**对外 URL 保持 `/img/:id` 不变** |
| 中枢 `hub.store` | 已写 R2 逻辑，但 `HUB_BUCKET` 未绑定 | 与全站共用 `ASSETS_BUCKET` |
| 作品 `stories.data` / `assets[]` | 已只存 `{ url, type }` | 继续；禁止 base64 内嵌 |
| 无限工具箱 | 浏览器本地 WASM，不上云 | 不变；用户主动「存入作品」才走 upload |

### D1 元数据表（替代 `images` + `image_chunks`）

新表 `file_objects`（迁移后 `image_chunks` 废弃，旧数据可只读回退或后台搬 R2）：

```
file_objects
  id            TEXT PK          -- 对外 id，仍 img_xxx 兼容旧 URL
  owner_id      TEXT NOT NULL
  r2_key        TEXT NOT NULL    -- 例 u/{owner}/a/{id}.webp
  content_type  TEXT NOT NULL
  byte_size     INTEGER NOT NULL
  sha256        TEXT             -- 可选，去重/校验
  scope         TEXT             -- story | character | world | hub | avatar
  scope_id      TEXT             -- 关联作品/角色 id（可空）
  category      TEXT             -- image | audio | video | frame | model | other
  created_at    TIMESTAMP
```

- 已有 `assets` 表（角色素材元数据）保留：**只存 url + meta_json**，url 指向 `/img/:id` 或未来 CDN。
- 任务类（中枢 DAG、异步生图）另可加 `hub_tasks` / `hub_task_steps`（状态、错误、产出 `file_object_id`），**任务表也不存 bytes**。

### R2 Key 约定

```
u/{owner_id}/a/{file_id}.{ext}     # 用户上传 / 作品素材
hub/{run_id}/{task_id}.{ext}       # 中枢流水线产出（可选）
models/{model_id}/...              # 未来：卡牌框、Live2D、权重（单独 MIME 白名单）
```

- Bucket 私有；通过 Worker `GET /img/:id` 鉴权/限流（与现网一致）。
- 单文件上限从 5MB 起步，R2 阶段可按类型放宽（视频/模型另设 cap）。

### 引用契约（全站统一）

业务 JSON 里只允许：

```json
{ "url": "/img/img_abc123", "type": "image|video|audio", "assetId": "可选，指向 file_objects.id" }
```

禁止：`data:` URL 入库、`base64` 字段、D1 TEXT 塞二进制。

### 迁移阶段

1. **Binding** ✅：`wrangler.toml` → `ASSETS_BUCKET` = `hyool-assets`；`hub.store` 走 `assetsBucket()`。
2. **双写** ✅：`POST /api/upload` → R2 + `file_objects`；失败回退 D1 chunks。`GET /img` 先 R2 后 chunk。
3. **回填** ✅：`POST /api/admin/backfill-r2`（仅账号 `333123`，可传 `{ limit }` 分批）。
4. **切读**：新上传已以 R2 为准；旧图回填完成后可停写 chunks。
5. **清理**（未做）：确认无 chunk-only 引用后再 DROP `image_chunks`。

实现：`src/assets-storage.js`、`schema/migrate_file_objects.sql`。
