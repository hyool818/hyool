# HYOOL 项目上下文交接（AI 会话记忆）

> 用途：跨窗口/跨会话继续开发时，新 AI 会话先读本文件 + `git log --oneline -10`，
> 即可恢复上下文并继续编码。所有已确认的架构决策都在这里，不要推翻。

## 会话工作约定（每个接手本项目的 AI 会话必须遵守）

1. **开工前**：读本文件 + `git log --oneline -15` + 相关源码，不要只凭文档就改代码
2. **收尾时**：每次完成任务并 commit 后，必须同步把本次改动摘要更新到本文件对应章节（已完成改造 / 架构决策 / 待办状态），保持文档与代码一致
3. **决策红线**：已确认的架构决策不得推翻；需要调整必须先问用户
4. **验证闭环**：代码改动必须经过 `node --check` + `npx wrangler deploy --dry-run`（涉及 DB 的改动用 `wrangler d1 execute --remote` 验证），再 commit + push main
5. **临时验证脚本**：放在 `.wrangler/` 下，测完即删，不提交
6. **主动提醒换窗口（硬性规定）**：当会话进入「不划算」区间——累计完成任务 ≥5 个、或已多次读大文件/长命令输出导致上下文明显偏长、或接下来仍有较长开发任务——必须主动提醒用户更换新窗口，并说明换后只需说一句「读 CONTEXT.md 和 git log 继续」。禁止因为怕丢当前对话而隐瞒或拖延提醒。

用户换窗口时只需说一句：读 `d:\hyool\CONTEXT.md` 和 git log，按文档约定继续。

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

## 已完成的前端改造（无限世界 · 图片工作台，均已部署）

1. **1cce3c0** — FastEdit 图片工作台上线：`public/workspace.html` + `public/workspace/js/*`。纯前端本地处理（压缩/转换/动图/视频/打码/抠图/批量），vendored jsquash WASM 编解码（webp/avif/jpeg/png/oxipng/gif），修复 15 处 vendored import 路径错误；`public/index.html` 无限世界入口跳转 `/workspace.html`
2. **2d8991c** — 无限世界·工具总览入口页（hub）：`workspace.html` 新增 hub 首页（hero + 工具卡片 + 世界入口），新增 `hub.js`（hub/编辑器视图切换、`?tool=editor|ai|presets` 直达、返回按钮）；`app.js` 暴露 `window.enterWorkspaceTab`；修复 `switchTab('edit')` 无对应面板导致导入图片后控制面板空白

前端架构要点（勿推翻）：

- **编解码全部浏览器本地 WASM**（jsquash + pako/UPNG/omggif），图片不上传服务器（隐私卖点）
- **无构建步骤**：`public/workspace/vendor/` 全是 ESM/WASM 静态文件；`pako/UPNG/omggif` 为经典脚本须先于 app.js 加载，`wasm-feature-detect` 裸导入靠 importmap 解析到 `/workspace/vendor/wasm-feature-detect/index.js`
- **冒烟测试**：`public/smoke-test.html`（编解码/动图/批量/视频）、`public/ui-check.html`（hub/编辑器切换 17 项）；本地起静态服务 + headless Chrome `--dump-dom` 验证（注：视频 roundtrip 在 headless 下会 FAIL，属环境限制非代码 bug）

## 已确认的架构决策（用户拍板，不要推翻）

- **三层分层**：内核层（后端固定 prompt，前端不可覆盖——防 prompt injection 绕过安全规则）/ 内容层（角色字段 + story_hook）/ 参数层（temperature/max_tokens/proactivity 由后端 clamp）
- **成人话题策略**：后端零关键词拦截，system 授权「双方自愿成年人」内容，红线全交给模型自判，拒绝时一句带过不教训
- **红线清单**：未成年性内容 / 虐杀极端暴力 / 种族·地域·性别·宗教歧视 / 涉政 / 违法活动 / 教唆自杀自残 / 真实可辨识人物恶意内容 / 非自愿性内容
- **回复规则**：短句 ≤50 字（对方抛具体问题可放宽到 150 字分点）、禁文字拟态词（（微笑）/*脸红*/～点头～等）、emoji 低频、绝不透露是 AI
- **禁手改 `.wrangler/dry/index.js`**（部署 bundle 自动生成）
- **摘要机制**：`compressHistory`（gateway.js 导出）增量合并摘要；chat 路由按 `summarized_upto` 增量触发（>20000 字符），摘要以【过往对话摘要】注入 # 记忆

## 新增工具规划（2026-08-20 拍板，多工具矩阵）

> 背景：无限世界·工具箱将扩展为「图片 / 音频 / 音乐 / 视频 / AI / 游戏」矩阵。均沿用现有架构约定：无构建步骤、浏览器端处理优先、CDN 懒加载 + IndexedDB 缓存、hub 卡片 + workspace/js 模块 + 冒烟测试。

### 入口划分（工具类 → 无限，制作类 → 幻想）——2026-08-20 追加拍板
- **无限入口**（`index.html` 无限世界 → `workspace.html` 工具箱）：处理素材的「工具类」——FastEdit 图片工作台（已上线）、音频工坊 `audio.html`、视频剪辑升级、图像超分、去水印、AI 扩图
- **幻想入口**（`index.html` 幻想世界 → `fantasy.html`，2026-08-20 激活）：创作产出的「制作类」——音乐工作室（MIDI+虚拟乐器）、H5 游戏（PixiJS B 路线）、自研 VN 编辑器、Live2D、TTS（GPT-SoVITS）
- **H5 游戏路线**：先走 B（PixiJS 在现有项目内写轻量小游戏，无构建、与工作台同构）；A（Cocos Creator 独立源工程 → Web 产物 → iframe+postMessage 嵌入）暂存档
- **速度优先级（哪些快做哪些）**：音频工坊（最快，纯前端）→ 幻想入口骨架 + 首款 PixiJS 小游戏 → 音乐工作室 → 视频剪辑升级 → 图像超分 → 其余按档

### ✅ 第一批（现在做，纯前端低风险）
1. **音频工坊 `public/audio.html`**：Web Audio API + Canvas 波形 + 裁剪/拼接/音量/淡入淡出/三频均衡/压缩器/反向 + 导出 WAV（原生 PCM）/ MP3（lamejs CDN 懒加载）；无限入口 hub 卡片直链
2. **幻想入口 `public/fantasy.html`**：制作类 hub 页，激活 index.html 幻想世界跳转 + workspace 世界链接
3. **首款 PixiJS H5 小游戏**（幻想入口第一件制作类作品，B 路线，PixiJS CDN 懒加载）

### ✅ 第二批（现在做，投入较大）
4. **音乐工作室（MIDI 编曲 + 虚拟乐器）**：@tonejs/midi 解析/生成 .mid + 自绘钢琴卷帘 + tone.js 回放；虚拟乐器用 Web Audio 合成 + WebAudioFonts 采样 + WebMIDI 输入（WebMIDI 仅 Chrome/Edge 且需用户手势，无 MIDI 设备时鼠标点卷帘兜底）
5. **视频剪辑升级**：主力 WebCodecs + mp4-muxer（硬件加速、无大包体；Chrome/Edge 94+、Safari 16.4+），复用现有 Canvas 打码/裁剪管线，新增 MP4 导出 / 音画合成；ffmpeg.wasm（~31MB，多线程需 COOP/COEP）仅做 WebCodecs 不可用或特殊格式时的兜底
6. **onnxruntime-web 图像超分**：Real-ESRGAN-x4 ONNX ~64MB，复用 ai.js 的 CDN 懒加载 + IndexedDB 缓存模式，ort-web wasm / WebGPU（Chrome 113+）双后端

### 🗄 存档后续（用户暂缓 / 需前置条件）
- **TTS 文字转语音**：目标 GPT-SoVITS（高质克隆音色），需 GPU，与 Workers 架构不兼容 → 与 QLoRA 微调一并归入「另起 GPU 推理栈」后做
- **onnxruntime-web 去水印（图片 / 动图 / 视频）**：LaMa inpainting ONNX ~200MB、浏览器 CPU 慢（需 WebGPU）、效果依赖水印类型；按 图片→动图→视频 顺序实验，视频逐帧在浏览器端可行性低（保留但不优先）
- **onnxruntime-web AI 扩图**：需生成式模型（SD 系），浏览器端不现实，且与隐私卖点冲突 → 暂缓
- **Live2D Cubism SDK for Web**：技术可行（纯前端 WebGL，SDK 免费、需展示版权声明）；瓶颈在模型资产（Cubism Editor 收费 / nizima 购买 / 官方样例），等用户提供模型文件后进第二批，用于 buddy 形象区呼吸 / 说话动画
- **自研 VN 编辑器（Ren'Py 替代，必做）**：剧本 JSON + Canvas/PixiJS 渲染 + 复用素材管线；不引入 Ren'Py 本体
- **H5 游戏路线 A（Cocos Creator）**：独立源工程 → CLI/CI 构建 Web 产物 → iframe + postMessage 双向通信嵌入站点（或独立路由）；暂存档

### ❌ 明确不做 / 已确认的可行方案
- **Ren'Py 本体**：Python 桌面引擎，无官方 Web 导出，renpy-web（Pyodide）实验性、体积大、体验差
- **Cocos Creator 作为工具箱原生工具**：独立 IDE/引擎工程，不嵌入；但其 H5 构建产物可 iframe 嵌入（路线 A）
- 已确认：**iframe 嵌入 + postMessage 双向通信 = 外部构建产物（H5 游戏/VN）接入站点的标准方式**，与页面是否用 Vue/React 无关，本项目原生静态 HTML 同样适用

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
