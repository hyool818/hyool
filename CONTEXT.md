# HYOOL 项目上下文交接（AI 会话记忆）

> 用途：跨窗口/跨会话继续开发时，新 AI 会话先读本文件 + `git log --oneline -10` + 任务相关源码，即可恢复上下文并继续编码。所有已确认的架构决策都在这里，不要推翻。
> **历史归档**：已完成/已验证的详细记录全部在 `docs/history.md`，本文件只保留当前有效信息。收尾时详细记录追加到 `docs/history.md`，本文件只写一行摘要。

## 会话工作约定（每个接手本项目的 AI 会话必须遵守）

1. **开工前**：读本文件 + `git log --oneline -10` + 只读与任务相关的源码，不做全项目宽泛检索
2. **收尾时**：每次完成任务并 commit 后，必须同步更新本文件（已完成写一行摘要 + 详细追加 `docs/history.md`），保持文档与代码一致
3. **决策红线**：已确认的架构决策不得推翻；需要调整必须先问用户
4. **不做验证（2026-08-22 用户拍板）**：取消 node --check / dry-run / CDP 冒烟 / 线上验证等一切验证环节（太耗时太慢）；改完直接 commit + push main（CI 自动部署），线上不行再改。验证相关命令仍在「常用命令」备用，确有必要才用
5. **临时验证脚本**：放 `.wrangler/` 下，测完即删，不提交
6. **换窗口（硬性）**：每完成 1 个任务就主动提醒换窗口；长任务中途或上下文明显变长时立即提醒；换后说「读 CONTEXT.md 和 git log 继续」即可。禁止因怕丢对话而拖延。
7. **检索/读取纪律**：搜索用精准 pattern；`.wrangler/` 是构建产物不参与检索；大文件用小段 `read_files`（≤400 行）；冒烟输出写文件，只报 PASS/FAIL 计数，不拉全文

用户换窗口时只需说：读 `d:\hyool\CONTEXT.md` 和 git log，按文档约定继续。

## 项目一句话

HYOOL = Cloudflare Workers 上的「数字生命」聊天网站：用户脑洞生成角色（create.html）、与角色实时聊天（buddy.html）、主页（yonder.html）、无限世界工具箱（workspace.html + 音频工坊 + 游戏工坊）、生命世界（world.html，多 AI 角色自主运转的「故事孵化器」）、工坊 hub（/hub，我的彼岸）。

## 技术栈与入口

- Workers + **Workers AI**：`@cf/meta/llama-3.3-70b-instruct-fp8-fast`（聊天 + 角色生成，见 `src/ai/gateway.js` 的 `chatCompletions`）
- D1 数据库（messages / conversations / memories / characters / worlds + world_json / world_threads / world_messages / sessions 等，schema 见 `schema/`，migration = 一个 SQL 文件一次改动）
- Vectorize 向量记忆（`searchRelevantMemories`，中文是短板）；头像 Pollinations；语音内置 TTS
- 入口：`src/index.js`（路由分发 + getAuthenticatedUser）、`src/mvp.js`（核心 API：chat `/api/buddy/:id/chat`，生命世界 `/api/worlds/:id/life/*`）、`src/ai/gateway.js`（LLM 网关）
- CI：push main 自动部署（GitHub Actions）

## 已确认的架构决策（用户拍板，不要推翻）

- **三层分层**：内核层（后端固定 prompt，前端不可覆盖）/ 内容层（角色字段 + story_hook）/ 参数层（temperature/max_tokens/proactivity 后端 clamp）
- **成人话题**：后端零关键词拦截，system 授权「双方自愿成年人」，红线全交模型自判；红线清单：未成年性内容 / 极端暴力 / 歧视 / 涉政 / 违法活动 / 教唆自杀自残 / 真实人物恶意 / 非自愿性内容
- **回复规则**：短句 ≤50 字、禁文字拟态词、emoji 低频、绝不透露是 AI
- **摘要机制**：`compressHistory`（gateway.js 导出）增量合并摘要，chat 按 `summarized_upto` 增量触发
- **禁手改** `.wrangler/dry/index.js`（部署 bundle 自动生成）
- **生命世界 = 故事孵化器**（2026-08-21 拍板）：AI 让世界自主产生可导出的连续故事；世界状态由系统自动维护（`world_json.state`），用户不设置；目标导出：小说 / Ren'Py / 分镜 / 游戏。详见下方「生命世界·故事孵化器」。
- **前端架构**：编解码全浏览器本地 WASM、无构建步骤、图片不上传服务器（隐私卖点）；iframe + postMessage = 外部构建产物接入标准；入口划分：无限=工具类（workspace）、幻想=制作类（fantasy）

## 生命世界·故事孵化器（当前核心）

> 最高目标：**你创造世界，AI 让世界发生故事。** 故事链：世界 → 故事 → 小说 / 视觉小说(Ren'Py) / 分镜 / 游戏。四象限：幻想 → 生命 → 无限 → 彼岸。

**已完成（Batch 1/2/3，均已部署 + 线上验证，详细见 docs/history.md）：**
- Batch 1/2：仙侠题材、角色库互通、封面上传、羁绊系统（bond 0~100，manual 强干扰优先）、AI 批量 NPC、线程背景/主线锁死、双栏布局等
- Batch 3 故事引擎：`world_json.state` 自动世界状态（story/beats/chapters/secrets/plots/timeline/lastPulseSeq）、节拍化 tick（`generateStoryBeat` 替代「挑人说一句」）、增量脉动 `updateWorldState`（积压 ≥4 条才跑）、affects/reveal/hide 后端立即落账、`GET /api/worlds/:id/life/story` 故事档案、world.html「故事」tab

**衔接既有（不推翻）**：Batch 1 羁绊保留（manual 覆盖优先）；Batch 2 规则/时代/氛围锁死作为种子设定喂给世界状态；成人红线/回复规则不变。

### ★ Batch 4 一键导出（当前唯一核心待办，未开工）

- **gateway.js 四个新函数**（均带 `mock` 兜底 + `mock` 参数）：
  - `exportWorldAsNovel` → Markdown：章节 + 正文（旁白→叙述、对白→引号、场景→段落）
  - `exportWorldAsRenpy` → `.rpy`：scene / character / dialogue / menu 分支
  - `exportWorldAsStoryboard` → 分镜 JSON：镜头 / 台词 / 场景描述
  - `exportWorldAsGame` → 任务 / NPC / 对话 / 世界状态 / 事件 JSON（未来可接 game-workshop）
- **新增** `POST /api/worlds/:id/life/export`：`target = novel|renpy|storyboard|game`
- **world.html「生成作品」区**：类型选择 → 生成 → 预览 + Blob 下载
- **新增** `public/story-export-check.html` 冒烟
- 验证：不做验证（见约定 4），生成后直接部署，线上由用户确认

## 最近已完成（2026-08-22）

- **首页主 logo 放大 + 间距优化**：`public/index.html` `.world-logo-main img` 桌面 96px→**160px**→**800px**、移动 72px→**120px**→**600px**（`logo.png` 主 logo，`logo1.png` 左上角未动，`max-width:88vw` 防溢出）；随后上下间距拉开：logo `top:4%`（移 3.5%）、上入口 fantasy `top:28%`（移 26%）、下入口 life `bottom:28%`（移 27%）。已 commit `12f2939`，CI 部署后线上生效。详见 docs/history.md。
- **用户主页分享链路限定在主页（`3533a94`）**：规则=游客在用户主页无论怎么操作都留在主页，仅点 LOGO 可回主站。改动：`buddy.html` 分享链接/游客登录提示携带 `?from=/@…`；`share.html` 识别 `from`，「与 TA 相遇」带回 from，「创造我的」/header/错误页按钮改为返回主页；`yonder-home.html` 门禁下 LOGO 可见可点（header z 100→810 高于 gate 800），移除门禁非 LOGO 的「返回首页」。详见 docs/history.md。

## 当前待办

- **★ Batch 4 一键导出**（见上，未开工）
- **收费作品支付（二维码收单）**：数据/徽章层已就绪（pricing/price 列），支付渠道未实现；用户拍板暂不开通，待主动提出再推进
- **观察期/暂缓**（用户主动提出再推进）：情绪/场景路由 Agent、RAG 知识库（embedding 可换 `@cf/baai/bge-base-zh-v1.5` 但需重建索引）；QLoRA 微调（需另起 GPU 推理栈）；世界消息清洗/归档；TTS/Live2D/VN 编辑器（自研 VN 编辑器 = 必做项，Ren'Py 替代）；音乐工作室 / 视频剪辑升级 / 图像超分
- 历史需求细节与完成记录：`docs/history.md`

## 常用命令

- 语法检查：`node --check src/xxx.js`（ESM 前端文件先复制成 `.mjs` 再 `node --check`）
- 本地起服务：`.\\start-dev.ps1`（8787 端口）；停止：`.\\stop-dev.ps1`
- 前端冒烟：`.\\run-browser-test.ps1 -Url http://127.0.0.1:8787/xxx-check.html -OutFile test-out-xxx.txt`
- 零浏览器快检（纯文案）：`.\\check-home-fast.ps1`（.ps1 含中文须 UTF-8 BOM）
- dry-run：`npx wrangler deploy --dry-run`
- D1 迁移（远程）：`npx wrangler d1 execute hyool-db --remote --file schema/xxx.sql`
- 部署：commit + push main（CI 自动）
- 注意：PowerShell 5.1 读中文文件设 UTF8；`read_files` 对同一文件多次范围读有缓存问题，可用 `Get-Content -Encoding UTF8` 绕过

## 已知限制

- llama-3.3-70b 自带安全层，极端表述仍可能被模型自身拦截/拒答，代码无法完全关闭
- **Workers AI 自动套 Llama chat template，禁止在 messages 里手写 `<|start_header_id|>` 等特殊 token**（双重模板崩盘）
- 本地 dev 的 Workers AI 远程绑定可能因代理挂起（60s 超时）；冒烟测试已走 `mock:true` 钩子，不受影响
- 线上邀请码 `HUBTEST2026` 曾因被禁用影响测试，激活时注意 is_active=1
