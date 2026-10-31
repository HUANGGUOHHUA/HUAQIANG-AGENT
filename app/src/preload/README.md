# app/src/preload

Electron 预加载脚本。

通过 contextBridge 向渲染进程暴露受控的 IPC API，不直接开放 Node.js。
