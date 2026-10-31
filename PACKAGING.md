# 华强以太 · 打包说明

## 产物

```text
output/
  HuaqiangAgent-<version>-portable.exe   便携版
  HuaqiangAgent-<version>-setup.exe      安装版
  win-unpacked/                          可直接运行的目录
  app.zip                                安装器内嵌负载
```

`output/` 整体为生成目录，不提交。

## 打包流程

```powershell
npm run build
npm run prepare:python   # 首次
npm run pack
npm run installer
```

- `npm run pack`：electron-builder 生成 `output/win-unpacked`，再压缩为 `output/app.zip`，最后由 `installer/launcher` 生成便携 exe。
- `npm run installer`：由 `installer/setup` 生成安装器，内嵌 `app.zip` 和卸载器。

## 结构

```text
app/src/               应用源码
installer/launcher/    C# 便携启动器
installer/setup/       C# 安装器 / 卸载器
runtime/python/        便携 Python
build/icon.ico         exe 图标
resources/icon.png     应用图标
```

## 签名

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-portable.ps1 `
  -SignThumbprint <cert-thumbprint>
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-installer.ps1 `
  -SignThumbprint <cert-thumbprint>
```

自签名证书只适合本机测试；公开分发请使用 OV/EV 证书。

## 安装器行为

- 不自动启动应用
- 不包含开发数据或对话记录
- 安装后由用户从桌面/开始菜单打开
- 卸载程序写入系统“应用和功能”
