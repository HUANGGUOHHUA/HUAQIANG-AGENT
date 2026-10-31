# app

Electron 应用主体。

```text
src/
  main/       主进程：窗口、Agent、工具、MCP、会话、设置
  preload/    contextBridge 暴露给渲染进程的 API
  renderer/   React 界面
  shared/     主进程与渲染进程共享类型
```

从仓库根目录运行：

```powershell
npm install
npm run prepare:python
npm run dev
```

构建产物输出到根目录 `out/`，不要直接修改。
