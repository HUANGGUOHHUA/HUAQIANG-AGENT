# installer

Windows 启动器与安装器源码，使用 C# / WinForms。

```text
launcher/   便携版单文件启动器
setup/      安装器与卸载器
```

由根目录脚本构建：

```powershell
npm run pack        # 便携版
npm run installer   # 安装版
```

输出目录：`output/`。安装器不包含对话记录，也不会在安装后自动启动应用。
