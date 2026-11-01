# 下载依赖

一键准备“华强以太”开发环境所需的依赖。

## 用法

双击：

```text
下载依赖.bat
```

或在 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\下载依赖.ps1
```

强制重新下载便携 Python：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\下载依赖.ps1 -Force
```

## 乱码 / 语法错误

如果双击后出现类似：

```text
Unexpected token '}' ...
Unexpected token '妫€鏌?Node.js' ...
```

说明 PowerShell 脚本被保存成了 **UTF-8 without BOM**。Windows PowerShell 5.1 会把无 BOM 的 UTF-8 中文按 GBK 解析，所以既乱码又报语法错误。

处理：

1. 确认 `下载依赖.ps1` 的文件编码为 **UTF-8 with BOM**；
2. 在 PyCharm 中启用 EditorConfig：`Settings → Editor → Code Style → Enable EditorConfig support`；
3. 项目根目录 `.editorconfig` 已设置：

```ini
[*.ps1]
charset = utf-8-bom
```

4. 重新从 Git 拉取文件，或把文件重新保存为 UTF-8 with BOM，再双击 `下载依赖.bat`。

不要用普通“UTF-8”格式覆盖 `.ps1`，也不要在 PyCharm 里直接双击 `.bat` 运行；请右键运行，或在终端执行。

## 会安装什么

1. **前端 / Electron 依赖**
   - 执行 `npm install`
   - 生成项目根目录的 `node_modules`

2. **便携 Python 运行时**
   - 下载 Python 3.12 embeddable
   - 安装到 `runtime/python`
   - 安装办公、数据、图片、PDF 依赖：
     - openpyxl、python-docx、python-pptx
     - pypdf、pdfplumber、reportlab
     - pandas、numpy、matplotlib
     - Pillow、requests、beautifulsoup4、XlsxWriter

## 前置条件

- Windows 10/11 x64
- Node.js 22.12+
- 首次准备 `runtime/python` 时需要系统 Python 3.12

如果已经有完整的 `runtime/python`，再次运行会跳过 Python 下载。

## 安装完成后

```powershell
npm run dev
```
