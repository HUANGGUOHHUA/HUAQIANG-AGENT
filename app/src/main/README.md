# app/src/main

Electron 主进程。

`index.ts` 只负责生命周期：单实例锁、`app://` 协议注册、`whenReady`、退出清理。
其余职责按模块拆分：

- `bootstrap.ts`：服务初始化、工作区可写性检查、后台任务（MCP / Python / Agent worker）
- `window.ts`：主窗口、渲染资源协议、截图调试钩子
- `state.ts`：bootstrap 填充的服务引用、活动任务表、统一中止
- `elevation.ts`：UAC 提权重启、完整性级别、提权握手标记、目录可写性检查
- `network-lock.ts`：断网锁（模型 API 不受影响）
- `vision-analyze.ts`：浏览器截图交给视觉模型
- `mime.ts`：扩展名到 Content-Type
- `ipc/app.ts`：版本、设置、模型、会话、MCP、Python、窗口、提权
- `ipc/workspace.ts`：工作区读写、打开方式、附件读取
- `ipc/agent.ts`：Agent 运行、压缩、审批、ESC 中止和工具装配
- `agent/`：Agent 循环、提示词、模型提供方与工具
- `attachments/`：OCR、PDF、边缘检测、附件读取

约定：

- 不新增全局可变单例，跨模块共享的服务统一挂在 `state` 上
- IPC 处理器只做参数校验和转发，业务逻辑放回对应服务
- 新增桌面/浏览器能力优先复用 `agent/tools/` 里的会话和脚本层，不要在工具定义里重复系统调用
