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
| 中枢 | `src/hub/` | Blueprint → DAG → 图/配音 → story JSON |

## 已拍板、不要推翻

- **三层 prompt**：内核（后端固定）/ 内容（角色字段）/ 参数（后端 clamp）
- **LLM 不维护世界/伴侣状态**；状态由确定性代码写 JSON
- **中枢**：LLM 只产企划书，不调工具；素材任务由 `deriveAssets` 派生
- **作品类型**：同一 `stories` 表 + `kind` 薄壳，不新开编辑器
- **商业级底座**：通用层（素材 / 场景 / 变量 / 事件 / Project State）与模板一律服务「小白 → 可上线作品」；不恢复接水果类玩具模板；新 `kind` 须能走到发布与主页/广场露出
- **生命世界 = 故事孵化器**：`world_json.state` 系统维护
- **禁手改** `.wrangler/` 构建产物
- 成人红线：后端不关键词拦截；未成年性内容等红线由模型自判（见历史文档）

## 前端约定

- **无构建步骤**（除 Workers 部署）
- 无限世界编解码：浏览器 WASM，`public/workspace/vendor/` 勿当业务代码改
- 入口：无限 = 工具类；幻想 = 制作类

## 配置

`wrangler.toml`：`ASSETS`、`DB`、`AI`、`VECTORIZE`、cron。Secrets 用 `.dev.vars`（不入库）。
