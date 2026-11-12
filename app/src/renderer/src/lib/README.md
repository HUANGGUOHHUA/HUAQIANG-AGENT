# app/src/renderer/src/lib

前端工具库。存放与界面无关的纯函数和跨组件逻辑。

- `agent-events.ts`：把 Agent 事件折进会话状态（流式消息、工具调用、审批、用量、压缩提示）
- `browser-scripts.ts`：注入 webview 页面执行的脚本（快照、元素选择、标题提取、同源 iframe 遍历）
- `browser-command.ts`：执行主进程下发的浏览器命令，全部页面交互都走 `executeJavaScript`
- `settings-form.ts`：设置页的配置草稿、`KEY=VALUE` 解析、token 数量格式化
- `context-usage.ts` / `usage.ts`：上下文预算与用量合并
- `slash-commands.ts`：斜杠命令解析、本地压缩、Markdown 导出
- `attachments.ts` / `zip.ts` / `turn-changes.ts`：附件处理、ZIP 导出、本轮变更汇总
