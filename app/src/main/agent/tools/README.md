# app/src/main/agent/tools

Agent 工具集合。

提供文件读写、精确编辑、搜索、PowerShell、系统信息、浏览器、文件定位和桌面控制等工具。

## 桌面控制

工具定义在 `desktop/tools.ts`，系统调用收敛在 `desktop/session.ts`：

- `ui_snapshot`：通过 Windows UI Automation 读取所有显示器上的窗口、控件、稳定编号和坐标（只适合标准 Win32 界面）
- `ui_click`：按编号/名称/类型自动定位并点击控件中心；UIA 找不到时回退到屏幕文字
- `screen_ocr`：识别文字，默认只返回前台窗口内的行（`scope="screen"` 才识别整个桌面），可限定区域
- `screen_vision`：把整屏截图交给支持图片输入的模型做视觉理解
- `screen_act`：通用视觉操作，模型每次返回一个 JSON 动作（点击/拖拽/输入/粘贴文件/按键/滚动）
- `screen_click_target`：按描述一步点击屏幕上的控件（按钮、图标、头像），QQ/微信等自绘界面首选
- `window_focus`：按标题切窗口到前台，返回窗口矩形
- `screen_edges`：本地边缘检测，返回矩形控件外框，用于 Canvas、自绘按钮
- `screen_click`：截图 + OCR + 点击一次完成
- `mouse_move` / `mouse_click` / `mouse_drag` / `mouse_scroll`
- `keyboard_type` / `keyboard_press`

自绘界面（QQ、微信、钉钉、游戏、安装器）没有可靠的 UIA 控件：直接用 `screen_click_target` 或 `screen_act` 按坐标点击，不要先 `ui_snapshot`。连续 2 次找不到控件时工具会返回提示，要求改用视觉点击。

目录结构：

| 文件 | 职责 |
| --- | --- |
| `desktop/tools.ts` | 17 个工具的参数、描述和动作分派 |
| `desktop/session.ts` | 截图、OCR、UIA 快照缓存、鼠标/键盘/剪贴板动作 |
| `desktop/scripts.ts` | PowerShell + C# 源码（鼠标、键盘、剪贴板、UIA、截屏） |
| `desktop/powershell.ts` | 脚本落盘执行、超时、错误转换 |
| `desktop/snapshot.ts` | 快照结构、目标挑选、短时缓存 |
| `desktop/visual.ts` | 视觉动作类型、JSON 解析、提示词 |

首次桌面操作会请求一次“接管屏幕和鼠标”的确认；批准后本轮桌面操作直接执行。批准后每次鼠标动作都会显示高亮，用户按 ESC 可随时中止任务。
