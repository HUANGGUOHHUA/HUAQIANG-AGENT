# 华强以太 · HQ Aetheon

> 华而实，善则强。

本地 AI 编程与系统助手，Electron 桌面应用。当前目录是干净的开发工作区，不包含安装包、运行产物或 Git 元数据。

![欢迎页](docs/assets/welcome.png)

## 目录结构

```text
app/
  src/
    main/                 Electron 主进程
      agent/              Agent 循环、提示词、模型适配、工具
      attachments/        图片 / PDF / OCR
      security/           工作区路径隔离
    preload/              contextBridge API
    renderer/             React 界面
      src/
        components/       界面组件
        lib/              前端工具函数
    shared/               共享类型

installer/                C# 启动器与安装器源码
  launcher/
  setup/

scripts/                  构建、签名、Python 运行时脚本
tests/                    Vitest 与 UI 冒烟测试
build/                    exe 图标
resources/                应用资源
docs/                     文档与截图
data/                     设置、API Key 与对话（自动生成，不提交）
.dev-profile/             Chromium 缓存与开发日志（自动生成，不提交）
output/                   打包输出（自动生成，不提交）
```

## 环境

- Windows 10/11 x64
- Node.js 22.12+（开发使用 Node 24）
- npm
- 首次准备 `runtime/python` 时需要系统 Python 3.12
- 打包 exe 需要 .NET Framework 4.8

## 开始开发

```powershell
npm install
npm run prepare:python
npm run dev
```

`prepare:python` 会下载并安装 `runtime/python`，供内置 Python、Excel、PDF、图片工具使用。运行时目录约 277MB，不纳入源码。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动开发窗口 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行测试 |
| `npm run build` | 构建 `out/` |
| `npm run prepare:python` | 准备便携 Python |
| `npm run pack` | 生成便携包到 `output/` |
| `npm run installer` | 生成安装包到 `output/` |
| `npm run pack:dir` | 生成可直接运行的目录 |

## 打包

```powershell
npm run pack
npm run installer
```

输出统一进入：

```text
output/
```

中间目录 `output/win-unpacked/`、`output/app.zip` 和 `output/Uninstall.exe` 不会提交。

## 测试

```powershell
npm run typecheck
npm test
```

当前：15 个测试文件、62 个测试通过。

## 说明

- 持久数据：`data/`
  - `data/settings.json`：模型配置、API Key、MCP、权限设置
  - `data/conversations/`：对话记录，每个对话一个 JSON 文件
- Chromium 缓存与日志：`.dev-profile/`
- 便携 Python：`runtime/`
- 构建缓存：`out/`、`output/`
- 默认接口写死在 `app/src/main/settings.ts`：
  `http://10.1.0.10:8080/v1/chat/completions`
- 以上运行目录都已在 `.gitignore` 中排除。
- 本目录不含 `.git`，可以直接复制、压缩或放到任意位置继续开发。

![模型设置](docs/assets/settings-model.png)

![上下文与缓存](docs/assets/context-ring.png)
