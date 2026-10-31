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
