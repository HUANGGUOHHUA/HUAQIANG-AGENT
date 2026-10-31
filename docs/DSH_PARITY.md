# DeepSeek Harness 功能对照与测试记录

这份清单用于对照 DeepSeek Harness 的核心交互，记录华强以太当前实现、测试方式和仍然缺失的能力。目标是先保证“写代码、改文件、长上下文、HTML 大输出”这些主路径稳定，再补齐助手型功能。

## 已对齐 / 已有等价实现

| 能力 | 华强以太实现 | 验证 |
| --- | --- | --- |
| 流式对话 | OpenAI / Anthropic SSE，文本、推理、工具调用 | `tests/mcp-provider.test.ts`、`ui-features.cjs` |
| 工具调用循环 | 多步工具调用、最大步数、取消；`maxSteps=0` 表示无限制 | `tests/agent.test.ts` |
| 文件工具 | 读写、精确编辑、删除、移动、目录、搜索 | `tests/agent.test.ts`、工作区路径隔离测试 |
| 命令执行 | PowerShell、中文输出、审批 | `tests/agent.test.ts` |
| 审批 | ask / auto、本次允许、本会话允许、拒绝 | UI + agent 集成测试 |
| 任务与工作区 | 左侧按会话 workspace 分组，切换会话同步切换工作区 | `ui-features.cjs` |
| 会话持久化 | `sessions/<id>.json`，原子写入，重启恢复 | `tests/persistence.test.ts` |
| 设置持久化 | `settings.json`，上下文窗口、模型参数、DPAPI Key | `tests/persistence.test.ts` |
| 上下文压缩 | 自动预算 + `/compact [说明]` 模型摘要，失败回退本地摘要 | `tests/context.test.ts`、`ui-features.cjs` |
| 指令菜单 | `/compact`、`/model`、`/export`、`/file`、`/help` | `ui-features.cjs` |
| 对话导出 | ZIP 内包含 Markdown 日志 | `tests/commands.test.ts` |
| 本轮变更 | 运行前后扫描工作区内容差异，文件工具和 Shell 命令造成的改动都会显示；不区分扩展名，显示全部文件、`+新增/-删除` 行数、展开全部 | `tests/workspace-changes.test.ts`、`ui-features.cjs` |
| 代码预览 | 按扩展名语法高亮；超 80KB 自动转纯文本避免卡顿 | `ui-features.cjs` |
| 大 HTML 输出 | 流式节流、超长内容折叠、工具参数进度、预览降级 | `tests/agent.test.ts`、`ui-stress.cjs` |
| 最终消息可靠落盘 | run-end 补偿丢失的 assistant-end | `tests/chat-race.cjs` |
| 网络异常 | SSE 300 秒无数据超时并取消读取 | `tests/sse.test.ts` + 构建 |
| MCP | stdio / Streamable HTTP、工具发现、resources 列表/读取、prompts 列表/获取、审批 | `tests/mcp-provider.test.ts`、`ui-features.cjs` |
| 内置 MCP 服务 | 进程内 MCP Server（InMemory transport），提供 python_run、Excel/Word/PPT/PDF/图片工具、workspace/python 资源、office_report/data_clean prompts 和 instructions | `tests/builtin-mcp.test.ts` |
| 工作区编辑 | 右侧预览直接编辑文本、Ctrl+S 保存、保存后刷新文件树；二进制/超大文件只读 | `tests/workspace-io.test.ts`、`ui-features.cjs` |
| 消息队列与重试 | 运行中继续输入并加入队列，结束后自动发送；失败卡一键重试上一条 | `tests/ui-queue.cjs` |
| 图片/二进制附件 | 图片显示缩略图；模型元数据/名称识别视觉能力，不支持时优先本地 Windows OCR 文本，OCR 不可用回退文件引用；API 拒绝图片时自动剥离图片重试；OpenAI image_url / Anthropic image block | `tests/vision.test.ts`、`tests/ocr.test.ts`、`tests/agent.test.ts`、`ui-features.cjs` |
| Composer 操作 | 左下角上传/快捷指令，右下角向上模型菜单 + 推理等级，权限向上选择不循环 | `ui-features.cjs`、`ui-queue.cjs` |
| 上下文容量 | 输入框圆环显示本地估算占比；点击展开「上下文已用」卡片，显示总量/上限、进度条和系统提示词/工具定义/对话消息拆分；≥70% 金色、≥90% 红色；超过 70% 自动压缩一次并显示摘要；请求 max_tokens 会按 prompt+工具+附件+安全余量收紧 | `tests/context-usage.test.ts`、`tests/commands.test.ts`、`tests/agent.test.ts`、`ui-context.cjs` |
| Token 缓存 | 底部 DSH 风格状态栏：轮/步/TPS、总 Token/缓存命中；点击展开 Token 用量、会话统计和上下文占比卡片；解析 OpenAI/DeepSeek/Anthropic cache usage；Anthropic 注入 system/tools/最后消息 `cache_control`，本地 OpenAI 端点带 `cache_prompt`，系统提示只保留稳定日期 | `tests/agent.test.ts`、`tests/persistence.test.ts`、`ui-context.cjs` |
| 思考链 | 思考分段与工具调用按 DSH 风格紧凑时间线展示；完成后自动收起为「思考与工具」摘要；可展开思考、参数和输出；助手消息头不重复显示模型 ID | `ui-steps.cjs`、`ui-features.cjs` |
| Python 基础环境 | 随程序携带 `runtime/python` 便携运行时，预装 Excel/Word/PPT/PDF、pandas/numpy/matplotlib、图片与网页处理库；目录可移动，系统提示注入解释器路径和库清单 | 运行时导入验证、设置页状态检查 |
| 系统提示 | 参考 DeepSeek Harness 工程 Agent 的写法与工具约定，覆盖工作方式、文件/命令/网络/MCP/Python 工具、权限边界、不可信数据、回答格式；用户附加要求只能补充，不覆盖安全规则 | `tests/prompt.test.ts` |
| PDF 文本提取 | `/file 文档.pdf` 本地提取文本（未压缩/FlateDecode），扫描版回退文件引用 | `tests/pdf.test.ts`、`tests/workspace-io.test.ts`、`ui-features.cjs` |
| 停止任务 | 停止时清空排队消息，避免停止后继续发送 | `tests/ui-queue.cjs` |
| 多模型配置 | 设置中新增/删除/切换多套配置，独立 Base URL、模型、上下文和密钥 | `tests/persistence.test.ts`、`ui-features.cjs` |
| 附件与每会话模型 | `/file` 文本/图片/二进制附件；`/model` 会话级覆盖 Model ID、上下文和最大输出 | `tests/agent.test.ts`、`ui-features.cjs` |

## 仍缺失 / 只做了部分

| 能力 | 现状 | 风险 / 建议 |
| --- | --- | --- |
| 低完整性环境 | 需要管理员启动或宿主 broker；没有自动降级写入 | 这是 Windows 安全边界，不是应用 bug |

## 测试方法

1. 单元测试：`npm test`（62 个）
2. 类型检查与构建：`npm run typecheck`、`npm run build`
3. UI 功能：`node tests/ui-features.cjs`（需要 `tests/ui-server.cjs`）
4. 大 HTML 流式压力：`node tests/ui-stress.cjs`
5. 队列/重试：`node tests/ui-queue.cjs`
6. 上下文圆环/自动压缩：`node tests/ui-context.cjs`
7. 思考链/紧凑步骤：`node tests/ui-steps.cjs`
8. 最终消息竞态：`node tests/chat-race.cjs`
9. 手工验收：HTML 代码块、HTML 文件工具写入、审批、停止、队列、右侧编辑保存、图片附件、切换工作区、`/compact`、`/export`

## 本轮已确认的缺陷与修复

- HTML 流式内容每帧触发 Markdown/高亮 → 50ms 节流 + 大内容纯文本 + 完成后折叠。
- 工具参数生成期间没有反馈 → `tool-draft` 进度事件与“正在生成 write_file 参数 · N 字符”。
- 大文件写入的审批预览 JSON 截断后不可解析 → 预览前先截断内容字段，保证 JSON 有效。
- 工具卡完整渲染大 HTML 参数 → 参数显示截断到 4KB。
- 变更汇总只有路径、没有行数、只显示前几条 → 全文件、`+/-` 行数、展开全部。
- 变更汇总只基于文件工具调用 → 每轮前后扫描工作区，Shell 命令创建/修改/删除的文件也进入汇总。
- 每次运行后变更随会话保存（`lastChanges`），重新打开仍可查看。
- 工作区预览超大 HTML 高亮卡顿 → 超过 80KB 使用转义纯文本。
- SSE 无数据时可能无限等待 → 300 秒 idle timeout。
- 右侧工作区只读 → 增加编辑/保存 IPC 与 Ctrl+S，保存后刷新文件树。
- 运行中不能继续输入 → 队列 chip + 结束后自动发送；失败卡提供重试上一条。
- 图片/二进制无法附加 → 图片缩略图 + OpenAI image_url / Anthropic image block；二进制作为引用。
- 不支持视觉的模型会收到图片数据并被 API 拒绝 → 读取模型视觉元数据/名称识别；不支持时改用 Windows OCR 文本，OCR 不可用回退引用。
- 图片上传只能从工作区选择 → Composer「+」打开系统文件选择器，读文本/图片/PDF 后附加。
- 模型/权限 chip 循环切换、模型选择是全屏弹窗 → 右下角向上模型菜单与推理等级，权限改为向上选择菜单。
- 推理等级没有请求参数 → 会话保存 reasoningEffort，OpenAI 兼容请求传 reasoning_effort。
- 上下文用量不可见 → Composer 圆环显示本地估算比例；达到 70% 自动压缩一次，避免重复循环。
- 固定保留最近 10 条消息 → 按 DeepSeek Harness 的 token 保留思路，保留最近约 16% 输入预算；切点对齐用户消息，摘要采用 `<compacted-summary>` 检查点并合并旧摘要。
- 思考过程被折叠成一个大卡片、工具卡彼此分离 → 改为 DSH 风格紧凑步骤时间线；思考按段落展示，工具步骤可展开；助手消息头移除重复的模型 chip。
- 思考完成后步骤一直展开 → 完成后自动收起为摘要，点击可重新展开。
- 没有可直接使用的 Python 环境 → 随程序携带 `runtime/python` 便携运行时，预装办公/数据/图像/PDF 基础库；路径注入系统提示；打包时放入 resources。
- 系统提示词偏宽松 → 参考 DeepSeek Harness 工程 Agent 的结构和工具约定重写；保留工作区、权限、安全等必要边界，但避免过度堆叠“最高优先级”规则。
- 模型返回的 max output 可能接近整个上下文窗口，导致 `prompt + max_tokens` 被 API 拒绝 → 请求前按 prompt、工具 schema、附件和安全余量动态收紧 max_tokens。
- 看不到缓存命中与 Token 构成 → 解析 provider cache usage，会话累计显示总 Token/命中率/未缓存输入/缓存读取/输出；Anthropic 注入 cache_control，本地 OpenAI 端点带 cache_prompt。
- PDF 只作为二进制引用 → 本地提取 PDF 文本（未压缩/FlateDecode），扫描版回退引用。
- 停止任务后排队消息仍会继续发送 → 停止时清空队列。
- MCP 只发现 tools → 同步发现 resources/prompts，新增 `*_resources`、`*_prompts` Agent 工具。
- 只消费外部 MCP → 自主实现内置 MCP Server，提供 Python/办公工具、resources、prompts 和 instructions；工具名改用 DSH 风格 `mcp__server__tool`。
- 设置只有一个通用配置 → 多配置标签页，新增/删除/切换并保存全部配置。
