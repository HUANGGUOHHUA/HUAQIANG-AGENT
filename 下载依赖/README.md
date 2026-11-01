# 下载依赖

一键准备“华强以太”开发环境所需的依赖。

脚本会检查环境、安装 `node_modules`，并准备便携 Python 运行时 `runtime/python`。整个过程不需要管理员权限。

## 用法

双击：

```text
下载依赖.bat
```

或在 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\下载依赖.ps1
```

强制重新构建便携 Python：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\下载依赖.ps1 -Force
```

在 PyCharm 中请右键 `下载依赖.bat` → **Run**，不要直接双击 `.ps1`。

## 会做什么

1. **检查 Node.js / npm**
   - 要求 Node.js 22.12 或更高版本
   - 直接调用 `npm.cmd`，不受 PowerShell 执行策略影响

2. **安装前端 / Electron 依赖**
   - 执行 `npm install`
   - 失败时自动用缓存重试一次
   - Electron 二进制缺失时自动通过 npmmirror 下载
   - 检查 `node_modules/electron/dist/electron.exe` 是否完整

3. **准备便携 Python 运行时**
   - 运行时完整：直接跳过
   - 只缺 Python 包：原地修复，不删除整个运行时
   - 运行时缺失或损坏：先在临时目录完整构建并测试，成功后才替换旧目录；失败时保留旧版本
   - 下载或安装中途关闭：旧运行时保持可用；下次启动自动清理临时目录
   - 替换过程中被中断：自动从 `runtime/python.old` 恢复旧版本
   - pip 优先使用清华镜像，失败后回退到官方 PyPI
   - Python embeddable 优先使用华为镜像，失败后回退到 python.org

4. **安装的 Python 包**
   - openpyxl、python-docx、python-pptx
   - pypdf、pdfplumber、reportlab
   - pandas、numpy、matplotlib
   - Pillow、requests、beautifulsoup4、XlsxWriter

## 日志

失败时查看：

```text
%TEMP%\HuaqiangAgent-deps.log
%TEMP%\HuaqiangAgent-python.log
```

## 前置条件

- Windows 10/11 x64
- Node.js 22.12+
- 首次构建 `runtime/python` 时需要系统 Python **3.12.x 64 位**

已经存在完整的 `runtime/python` 时，不再需要系统 Python。

## 乱码 / 语法错误

如果出现类似：

```text
Unexpected token '}' ...
Unexpected token '妫€鏌?Node.js' ...
```

说明 `下载依赖.ps1` 被保存成了 **UTF-8 without BOM**。Windows PowerShell 5.1 会把无 BOM 的 UTF-8 中文按 GBK 解析。

处理：

1. 确认 `下载依赖.ps1` 编码为 **UTF-8 with BOM**；
2. PyCharm 启用 EditorConfig：`Settings → Editor → Code Style → Enable EditorConfig support`；
3. 项目根目录 `.editorconfig` 已设置：

```ini
[*.ps1]
charset = utf-8-bom
```

4. 重新从 Git 拉取文件，或把文件另存为 UTF-8 with BOM。

不要用普通“UTF-8”格式覆盖 `.ps1`。

## 安装完成后

```powershell
npm.cmd run dev
```

使用 `npm.cmd` 而不是 `npm`，可以避开 PowerShell 的 `npm.ps1` 执行策略限制。
