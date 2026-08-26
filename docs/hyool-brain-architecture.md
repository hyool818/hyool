# HYOOL 中枢（AI 大脑）—— 底层架构

> 一句话：用户一句话 → 规划器产出 **Project Blueprint（企划书）** → 编排层按蓝图派发
> **确定性任务 DAG** → 工具层产出素材/配音 → `composeStoryJSON` 落地为
> **story-editor 可播放作品**（前端写入 `hyool_stories_v1`，localStorage）。

本架构的目标是**可操作、可验证、可接续**：所有能力都以「确定性代码 + 单一数据模型」组织，
LLM 只在规划器内产内容，不参与任何调度与工具调用决策。

---

## 1. 总体架构

```
┌───────────────────────── 前端（Phase 0 中枢页，未实现）─────────────────────────┐
│ 一句话需求 → POST /api/hub/plan → 企划书确认/人审 → POST /api/hub/run → 试玩      │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │
┌──────────────────────── 后端 Worker（src/hub/，已实现）─────────────────────────┐
│                                                                                 │
│  hub/index.js  API 路由（登录校验 / 编排入口 / 进度返回）                         │
│       │                                                                         │
│  hub/planner.js  规划器：LLM(gateway.chatCompletions) → Blueprint JSON           │
│       │              → normalize → validate → 失败把错误反馈给 LLM 重试          │
│       ▼                                                                         │
│  hub/blueprint.js  数据模型：schema/校验/资产派生/composeStoryJSON               │
│       │              （LLM 产 meta+cast+chapters+logic；素材任务代码派生）        │
│       ▼                                                                         │
│  hub/engine.js  编排引擎：任务 DAG（循环检测/拓扑推进/缓存/指数退避重试）          │
│       │                                                                         │
│       ▼                                                                         │
│  hub/tools.js  工具层：统一 Tool 接口 + 注册表                                    │
│       ├─ hub.image  Pollinations/Flux 文生图（prompt+seed → 字节）               │
│       ├─ hub.tts    Edge TTS 配音（复用 src/tts.js synthesizeEdgeTts）           │
│       ├─ hub.store  素材入库 R2（env.HUB_BUCKET；未配置则 ephemeral 降级）        │
│       └─ hub.story  组作品：Blueprint+素材映射 → story-editor 数据结构           │
└─────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
现有资产：src/ai/gateway.js（chatCompletions，已导出）、src/tts.js（synthesizeEdgeTts/TTS_VOICES）、
         /api/upload（D1 分块存储，Phase 1 决定素材落 R2 还是复用 D1）
```

依赖关系（新窗口接续时的唯一入口）：`src/index.js` 挂载 `handleHubRoutes`（已有），
后续全部改动收敛在 `src/hub/` 下，与现有 MVP/生命世界互不干扰。

---

## 2. 核心数据模型：Project Blueprint

`schema: "hyool.brain.v1"`。结构（LLM 产出的「创作内容」部分）：

```js
{
  schema: "hyool.brain.v1",
  meta: {
    title: "水墨·夜雨听剑",          // 作品名（唯一性锚点，参与所有 seed）
    concept: "一句话概念",
    logline: "高概念一句话",
    style: "shuimo",                 // 风格 preset id（STYLE_PRESETS 枚举）
    orientation: "landscape"         // landscape | portrait
  },
  cast: [{                          // 角色卡（跨素材一致性的锚点）
    id: "cast_yun",                  // 全局唯一 ^[a-z][a-z0-9_]{1,31}$
    name: "云眠", gender: "female", age: "young", role: "女主角·剑侍",
    appearance: "一袭青衫，墨发，眉间朱砂",   // 生成立绘用
    personality: "清冷寡言",                 // 剧本性格约束
    voiceId: "zh-CN-XiaoxiaoNeural"          // TTS 音色（由音色表按性别挑选）
  }],
  chapters: [{                       // 章节
    id: "ch_1", title: "第一章 夜雨",
    blocks: [                        // 积木（类型：scene/dialogue/choice）
      { id: "b_1", type: "scene",    content: "烟雨古寺……" },        // 既是画面提示词也是场景文字
      { id: "b_2", type: "dialogue", speaker: "cast_yun", content: "雨快来了。" },
      { id: "b_3", type: "choice",   prompt: "你如何回应？", options: [
        { label: "接伞入寺", target: "b_4", require: [], effect: [{ var: "trust", op: "+", val: 2 }] }
      ]}
    ]
  }],
  logic: { state: { trust: 0 }, rules: {} }   // Phase 2 分支/状态/战斗等确定性规则
}
```

**素材任务（assets）不由 LLM 产出，由 `deriveAssets(bp)` 确定性派生**：
- 每个角色 → `img_<castId>` 立绘（prompt = 风格 base + 角色卡 appearance，seed = djb2(标题|castId)）
- 每个 scene 块 → `img_<blockId>` 背景图（prompt = 风格 base + content，seed = djb2(标题|blockId)）
- 每个 dialogue 块 → `tts_<blockId>` 配音（text = content，voice = cast.voiceId）

### Blueprint ↔ story-editor 数据结构映射（composeStoryJSON）

| Blueprint | story-editor（hyool_stories_v1） |
|---|---|
| meta.title / orientation | 作品 `title` / `orientation` |
| cast[].name + voiceId | 作品 `cast`：`{ 角色名: { kind:"tts", voice } }` |
| scene 块 | `{ type:"scene", content, media:{url,type:"image"}, subtitle:{on:true} }` |
| dialogue 块 | `{ type:"dialogue", speaker:角色名, content, audio:{url,type:"audio"}, subtitle:{on:true} }` |
| choice 块 | Phase 2 前降级为对白（`【选择】…`），原结构保留在 `_choice` 字段 |

---

## 3. 关键设计决策（为什么这么做）

1. **LLM 只产企划书，不调工具**——LLM 自由调工具会产生不可控漂移；Blueprint 是一次性
   结构化交付物，控制流 100% 由确定性 DAG 承担，每一步可审计、可重跑。
2. **跨素材一致性靠「角色卡 + 风格锁定 + seed 复用」**——所有图的 prompt 前缀都拼
   `STYLE_PRESETS[style].base`（水墨锚点），同一角色/场景的 seed 由 djb2(标题|id) 确定性
   生成，重复执行产出相同（可缓存）；Phase 1 可升级为「先出参考图、再图生图」。
3. **游戏逻辑用确定性代码解释 JSON**——分支/战斗/卡牌/关系不靠 LLM 现场发挥，
   由 logic.state + rules 配置 + 播放器解释执行（Phase 2）。
4. **素材任务派生化**——LLM 不写 prompt 细节，由代码拼装，减少 token 与出错面。
5. **失败降级策略**——未配 R2 时素材走 ephemeral（引用上游 URL，不落盘），
   整条流水线可端到端跑通后再逐步启用存储。
6. **人审 checkpoint 内置在流程**：`plan`（剧本定稿）与 `run`（素材产出）分离，
   Phase 1 追加素材选片与终版发布两级确认。

---

## 4. 模块清单与职责（src/hub/）

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `blueprint.js` | 数据模型：常量/规范化/校验/资产派生/落地映射 | `STYLE_PRESETS`、`normalizeBlueprint`、`validateBlueprint`、`deriveAssets`、`composeStoryJSON`、`djb2` |
| `planner.js` | 规划器：LLM → Blueprint（JSON 提取 + 校验反馈重试） | `planProject`、`parseJSON` |
| `engine.js` | 编排：任务 DAG 执行/缓存/重试/进度 | `runWorkflow`、`serializeResult` |
| `tools.js` | 工具层：统一 Tool 接口 + 注册表 | `TOOL_REGISTRY`、`getTool` |
| `index.js` | API 路由：`/api/hub/meta|plan|run` | `handleHubRoutes` |

复用（不重复造）：`src/ai/gateway.js` 的 `chatCompletions`（已导出）、
`src/tts.js` 的 `synthesizeEdgeTts` + `TTS_VOICES`、现有登录鉴权 `getAuthenticatedUser`。

---

## 5. 工具接口契约（tools.js）

```js
// 每个工具：
{ id, label, retryable: true|false,
  run(input, ctx) → Promise<{ result, meta }>   // 抛错 = 失败，由引擎按 retryable 重试
}
// ctx = { env, userId, deps: Map(任务id → {status,result,meta}), log }
```

| id | 输入（input） | 输出（result） | 说明 |
|---|---|---|---|
| `hub.image` | `{prompt,width,height,seed}` | `{url,bytes,mime,width,height,seed}` | Pollinations+Flux，非图片响应抛错 |
| `hub.tts` | `{text,voice,rate?,pitch?,volume?}` | `{bytes,mime:"audio/mpeg",voice,text}` | 复用 `synthesizeEdgeTts` |
| `hub.store` | `{key,mime,sourceDep,sourceUrl?}` | `{url:"/img/<key>",stored}` | 未配 R2 → `{url:上游URL, ephemeral:true}` |
| `hub.story` | `{blueprint}` | `{story}` | 从 `ctx.deps` 收集 store 结果组装作品 |

**新增工具约定**：注册进 `TOOL_REGISTRY` 即被引擎识别，无需改 engine/index；任务编排在
`hub/index.js` 的 `buildTasks()` 中声明（Phase 1 新增工具在此接线）。

---

## 6. 编排引擎语义（engine.js）

任务 = `{ id, tool, input, dependsOn?, retries?, cacheKey? }`

- **依赖**：`dependsOn` 全部 ok 才执行；缺失依赖/循环依赖在建图阶段即抛错。
- **缓存**：`cacheKey` 命中则复用 `{result,meta}` 并标记 `cached:true`（素材级去重）。
- **重试**：失败按 `500ms * 2^n` 指数退避重试 `retries` 次。
- **失败语义**：任务 failed 后，所有下游任务标记 `skipped`（不会半成品成稿）。
- **进度**：`onProgress({done,total}, results)` 回调（Phase 1 接 D1/KV 做进度持久化）。
- **并发**：默认 3，就绪任务成批推进。

---

## 7. 规划器策略（planner.js）

1. 单次 LLM 调用产出完整 Blueprint（maxTokens≈3200，temperature 0.7）。
2. `parseJSON` 稳健提取（去 markdown 代码块 / 首尾杂物）。
3. `normalizeBlueprint` 补默认值 → `validateBlueprint` 结构校验。
4. 失败则把具体错误（如「对白引用不存在的角色 cast_9」）反馈给 LLM 修正重试，最多 3 次。
5. 提示词内置：Blueprint 示例、风格枚举、音色表、id 规则、内容安全红线。
6. 预留 `multiStep:true` 分阶段生成（先大纲后逐章展开），Phase 1 实现长剧本。

---

## 8. API 契约（已挂载，登录必需）

| 端点 | 请求 | 响应 |
|---|---|---|
| `GET /api/hub/meta` | — | `{ styles:[{id,label}], voices:[TTS_VOICES] }` |
| `POST /api/hub/plan` | `{ request, options? }` | `{ blueprint, assets:{images,voices}, attempts }` |
| `POST /api/hub/run` | `{ blueprint, dryRun? }` | `{ report:{任务id→状态}, story, assetCount }` |
| `POST /api/hub/run` | `{ blueprint, dryRun:true }` | 返回任务 DAG 清单（调试用） |

`run` 会真实调用 Pollinations（外部 HTTP）+ Edge TTS（外部 WS），属长耗时请求；
Phase 1 需引入异步任务化（D1 存进度 + 轮询/回调），当前为同步响应骨架。

---

## 9. 测试策略

- 本地冒烟（已就绪，`node .wrangler/hub-test/hub-test.mjs` 与 `engine-test.mjs`，
  脚本用 `.mjs` 副本方式直跑源模块，不入库）：校验/派生/落地映射、DAG 缓存/重试/阻塞/环检测。
- 构建验证：`wrangler deploy --dry-run`（打包整个 import 图）。
- Phase 1 追加：基于 `.wrangler/story-av-smoke.cjs` 扩展为**自动通关测试**——
  plan→run 产物写入 story-editor 后真实播放器逐块推进 + 素材 URL/时长断言。

---

## 10. 分阶段路线

- **Phase 0（本次）**：底层架构落地——Blueprint 模型 + 规划器 + DAG 引擎 + 工具层 + API 骨架 ✅
- **Phase 1**：素材持久化（R2/D1）、素材人审 checkpoint、长剧本 multiStep、异步任务与进度、
  自动通关测试、前端中枢页（一句话输入 → 企划书人审 → 生成 → 写入 localStorage → 试玩）。
- **Phase 2**：分支引擎（choice 真实跳转 + logic.state/rules 解释执行）、战斗/卡牌/关系系统。
- **Phase 3**：文生视频、Live2D/数字人、音乐生成（均为「能力待验证」，见评估结论）。

---

## 11. 当前实现状态

| 项 | 状态 |
|---|---|
| `gateway.js` 导出 `chatCompletions` | ✅ 已导出（向后兼容） |
| `src/hub/` 五个模块 | ✅ 已实现，dry-run 打包通过 |
| 模型层 / 引擎层冒烟测试 | ✅ 全通过 |
| R2 素材持久化 | ⚠️ 工具已就绪，未建 R2 binding（`HUB_BUCKET`），当前 ephemeral 降级 |
| 前端中枢页 / 人审 UI | ✅ `public/brain.html`（plan → 人审 → run / 文字骨架 → 编辑器） |
| 表现层临场一句 | ✅ `POST /api/hub/live-line` + 编辑器 `perf` 积木（失败回退预设） |
| 异步任务 / 进度持久化 | ⏳ Phase 1（run 仍为同步长请求） |
| 分支引擎与游戏逻辑 | ✅ 编辑器 `choice` + `logic.state` require/effect；Blueprint logic 可继续加厚 |

**接续入口**：新窗口先读本文档 + `src/hub/*.js`，从 `docs/history.md` 惯例记一条本次记录，
再按 Phase 1 清单推进。

