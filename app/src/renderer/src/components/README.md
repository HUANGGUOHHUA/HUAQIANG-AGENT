# app/src/renderer/src/components

React 界面组件。

- 对话：`Conversation`、`MessageItem`、`StepTimeline`、`Composer`、`Sidebar`、`ChatHeader`
- 设置：`SettingsModal`（负责状态与保存）、`settings/ModelTab`（模型接入页）、`settings/McpEditor`（MCP 服务器编辑）
- 浏览器：`BrowserPane`（只负责标签页和 webview 生命周期）；页面脚本在 `lib/browser-scripts.ts`，命令执行在 `lib/browser-command.ts`
- 右侧面板：`RightPanel`、`TurnChanges`、`ImageViewer`
- 覆盖层：`ApprovalModal`、`ScreenshotOverlay`、`TitleBar`

约定：组件内只保留渲染和交互状态；可复用的状态折叠、命令执行和解析逻辑放进 `lib/`，便于单测。
