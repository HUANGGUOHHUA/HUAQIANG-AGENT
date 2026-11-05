# app/src/main/agent/tools

Agent 工具集合。

提供文件读写、精确编辑、搜索、PowerShell、系统信息、浏览器、文件定位和桌面控制等工具。

桌面控制工具：

- `ui_snapshot`：通过 Windows UI Automation 读取前台窗口和控件坐标
- `screen_ocr`：截取主屏幕并调用 Windows.Media.Ocr
- `mouse_move` / `mouse_click` / `mouse_drag` / `mouse_scroll`
- `keyboard_type` / `keyboard_press`

屏幕读取和输入注入始终要求用户确认，即使用户选择了自动执行。
