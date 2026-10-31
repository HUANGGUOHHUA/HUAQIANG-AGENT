# 华强以太 · HQ Aetheon

> 华而实，善则强。

本地 AI 编程与系统助手，Electron 桌面应用。

![欢迎页](docs/assets/welcome.png)

## 前置条件

在开始之前，请确认电脑满足以下条件：

| 条件 | 要求 | 说明 |
| --- | --- | --- |
| 系统 | Windows 10/11 x64 | 不支持 32 位系统 |
| Node.js | 22.12 或更高 | 用于安装前端依赖和启动 Electron |
| npm | 随 Node.js 安装 | 用于执行 `npm install` |
| Python | 3.12 | 仅首次下载便携 Python 时需要 |
| .NET Framework | 4.8 | 仅打包 Windows exe 时需要 |
| 网络 | 可访问 npm / PyPI / 华为云镜像 | 下载依赖 |
| 磁盘 | 至少 1.2GB 可用空间 | 依赖约 620MB，便携 Python 约 277MB |

检查是否已经安装：

```powershell
node --version
npm --version
python --version
```

Node.js 下载地址：

```text
https://nodejs.org/
```

Python 3.12 下载地址：

```text
https://www.python.org/downloads/
```

安装 Python 时请勾选：

```text
Add python.exe to PATH
```

## 获取代码

使用 Git：

```powershell
git clone https://github.com/HUANGGUOHHUA/HUAQIANG-AGENT.git
cd HUAQIANG-AGENT
```

也可以在 GitHub 页面点击：

```text
Code → Download ZIP
```

解压后进入项目目录。

## 下载依赖

推荐直接双击：

```text
下载依赖\下载依赖.bat
```

或者在项目根目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\下载依赖\下载依赖.ps1
```

脚本会自动完成：

1. 检查 Node.js 和 npm
2. 执行 `npm install`，下载 Electron / React / Vite / TypeScript 等前端依赖
3. 下载 Python 3.12 embeddable
4. 把便携 Python 安装到 `runtime/python`
5. 安装 Excel、Word、PPT、PDF、图片、数据处理依赖
6. 检查所有 Python 包能否正常导入

如果 `runtime/python` 已经完整，脚本会跳过 Python 下载。

强制重新下载便携 Python：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\下载依赖\下载依赖.ps1 -Force
```

### 手动下载

如果不使用脚本，也可以手动执行：

```powershell
npm install
npm run prepare:python
```

## 启动开发版

```powershell
npm run dev
```

成功后会打开：

```text
华强以太 · 华强职校 AI 编程助手
```

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

下载依赖/                 一键安装依赖脚本
scripts/                  构建、签名、Python 运行时脚本
tests/                    Vitest 与 UI 冒烟测试
build/                    exe 图标
resources/                应用资源
docs/                     文档与截图

data/                     设置、API Key 与对话（自动生成，不提交）
.dev-profile/             Chromium 缓存与开发日志（自动生成，不提交）
output/                   打包输出（自动生成，不提交）
```

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

## 数据位置

- 持久数据：`data/`
  - `data/settings.json`：模型配置、API Key、MCP、权限设置
  - `data/conversations/`：对话记录，每个对话一个 JSON 文件
- Chromium 缓存与日志：`.dev-profile/`
- 便携 Python：`runtime/`
- 构建缓存：`out/`、`output/`
- 默认接口写死在 `app/src/main/settings.ts`：
  `http://10.1.0.10:8080/v1/chat/completions`
- 以上运行目录都已在 `.gitignore` 中排除。

## 许可证

本项目采用 **GNU General Public License v3.0**，SPDX 标识：

```text
GPL-3.0-only
```

完整条款见：

```text
LICENSE
```

你可以自由使用、修改和分发本项目，但分发修改后的版本时必须继续使用 GPLv3，并提供对应源代码。本项目不提供任何担保。

![模型设置](docs/assets/settings-model.png)

![上下文与缓存](docs/assets/context-ring.png)
