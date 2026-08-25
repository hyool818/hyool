# HYOOL 项目上下文交接

> **2026-08-25 起**：开工读 `docs/MASTER_SPEC.md` + `docs/FEATURES.md` 对应条目，不要读本文件全文。  
> 本文件只保留操作纪律与待办。架构/功能/数据以 `docs/` 分册为准。  
> 长历史：`docs/history.md`。

## 会话工作约定

1. **开工**：`MASTER_SPEC` → `FEATURES` 当前功能文件 → 小范围源码。禁止全仓库检索。
2. **收尾**：`docs/CHANGELOG.md` 一行摘要；细节追加 `docs/history.md`。
3. **决策红线**：见 `docs/ARCHITECTURE.md`；要推翻先问用户。
4. **不做验证（2026-08-22）**：不跑 node --check / dry-run / CDP / 线上验证；commit + push main，CI 部署。确有必要再用文末命令。
5. **临时脚本**：`.wrangler/`，测完即删，不提交。
6. **换窗口**：每完成 1 个任务提醒换窗口。换后说「读 docs/MASTER_SPEC.md 继续」。
7. **检索**：精准 pattern；不搜 `archive/`、`vendor/`、`.wrangler/`；大文件分段 Read（≤400 行）。
8. **先找对再动手**：找不到就问，不要猜着改。
9. **终端**：PowerShell 5.1；命令短、一条一事；`git --no-pager`；禁止 here-string 传大段中文；工具退出码可能误报，以输出为准。git/node 偶发 300s 超时属 Defender/autocrlf，不代表代码坏了。

## 当前待办

- Batch 4 一键导出：暂缓
- 收费作品支付：数据层已有，渠道未做，暂缓
- 观察期：情绪路由 Agent、RAG 换中文 embedding、QLoRA、世界消息归档、TTS/Live2D、VN 后续、音乐工作室、视频超分等——用户提出再做

## 常用命令（备用）

- 本地：`.\\start-dev.ps1`（8787）；停止 `.\\stop-dev.ps1`
- D1：`npx wrangler d1 execute hyool-db --remote --file schema/xxx.sql`
- 部署：commit + push `main`

## 已知限制

- Llama 自带安全层，代码关不掉全部拒答
- Workers AI 会套 chat template，禁止在 messages 里手写特殊 token
- 邀请码 `HUBTEST2026` 曾被禁用，测试时看 `is_active`
