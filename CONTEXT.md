# HYOOL 项目上下文交接（AI 会话记忆）

> 用途：跨窗口/跨会话继续开发时，新 AI 会话先读本文件 + `git log --oneline -10`，
> 即可恢复上下文并继续编码。所有已确认的架构决策都在这里，不要推翻。

## 项目一句话

HYOOL = Cloudflare Workers 上的「数字生命」聊天网站：用户脑洞生成角色（创建页 create.html）、与角色实时聊天（buddy.html）、主页（yonder.html）。AI 对话能力集中在 LLM 网关模块。

## 技术栈与入口

- Workers + **Workers AI**：`@cf/meta/llama-3.3-70b-instruct-fp8-fast`（聊天 + 角色生成，见 `src/ai/gateway.js` 的 `chatCompletions`）
- D1 数据库（messages / conversations / memories / characters / sessions 等表，schema 见 `schema/` 目录，migration 惯例 = 一个 SQL 文件一次改动）
- Vectorize 向量记忆检索（`searchRelevantMemories`，embedding 用 `@cf/baai/bge-base-en-v1.5`，中文是短板）
- 角色头像：Pollinations 图片 API；语音：内置 TTS
- 入口：`src/index.js`（路由分发 + getAuthenticatedUser），`src/mvp.js`（核心 API 路由，chat 在 `/api/buddy/:id/chat`），`src/ai/gateway.js`（LLM 网关）
- CI：push main 自动部署（GitHub Actions）

## 已完成的对话能力改造（近 3 次提交，均已部署）

1. **a877d6a** — System Prompt 分区模板重构：身份 / 对方（用户昵称）/ 关系阶段（intimacy 分档）/ 回复规则 / 话题边界 / 记忆；成人话题低审核 + 硬性红线；proactivity / story_hook / 昵称接线
2. **4dd0099** — emoji 低频化：默认无 emoji，每 3~4 条最多一次
3. **78d53a2** — 扣子式对话流程（共情优先→澄清梳理→客观拆解→分层方案→边界提醒+危机引导）；方案模式 max_tokens 默认 200；**超长对话自动摘要**（conversations 新增 summary / summarized_upto，增量合并压缩，最近 12 条永不摘要）

## 已确认的架构决策（用户拍板，不要推翻）

- **三层分层**：内核层（后端固定 prompt，前端不可覆盖——防 prompt injection 绕过安全规则）/ 内容层（角色字段 + story_hook）/ 参数层（temperature/max_tokens/proactivity 由后端 clamp）
- **成人话题策略**：后端零关键词拦截，system 授权「双方自愿成年人」内容，红线全交给模型自判，拒绝时一句带过不教训
- **红线清单**：未成年性内容 / 虐杀极端暴力 / 种族·地域·性别·宗教歧视 / 涉政 / 违法活动 / 教唆自杀自残 / 真实可辨识人物恶意内容 / 非自愿性内容
- **回复规则**：短句 ≤50 字（对方抛具体问题可放宽到 150 字分点）、禁文字拟态词（（微笑）/*脸红*/～点头～等）、emoji 低频、绝不透露是 AI
- **禁手改 `.wrangler/dry/index.js`**（部署 bundle 自动生成）
- **摘要机制**：`compressHistory`（gateway.js 导出）增量合并摘要；chat 路由按 `summarized_upto` 增量触发（>20000 字符），摘要以【过往对话摘要】注入 # 记忆

## 观察期 / 待办（用户暂缓，用户主动提出再推进）

- 第三层：情绪/场景路由 Agent、RAG 知识库（若做：embedding 可换 `@cf/baai/bge-base-zh-v1.5`，但需重建向量索引）
- 第四层：QLoRA 微调——**与 Workers 架构不兼容**（Workers AI 不支持自定义权重），需另起 GPU 推理栈
- 前端文案（buddy.html / create.html）未动，属可选优化

## 已知限制

- llama-3.3-70b 自带安全层，极端表述仍可能被模型自身拦截/拒答，代码无法完全关闭
- **Workers AI 自动套 Llama 官方 chat template，禁止在 messages 里手写 `<|start_header_id|>` 等特殊 token**（会双重模板崩盘）

## 常用命令

- 语法检查：`node --check src/xxx.js`
- dry-run：`npx wrangler deploy --dry-run`
- D1 迁移（远程）：`npx wrangler d1 execute hyool-db --remote --file schema/xxx.sql`
- 部署：commit + push main（CI 自动）
- 验证 prompt：可在 `.wrangler/` 下写临时脚本 + `node` 运行（用完删除）
- 注意：PowerShell 读中文文件设 `$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8`；`read_files` 对同一文件多次范围读取有缓存问题，可用 `Get-Content -Encoding UTF8` 绕过
