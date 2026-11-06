# app/src/main/agent/tools

Agent 工具集合。

提供文件读写、精确编辑、搜索、PowerShell、系统信息、浏览器、文件定位和桌面控制等工具。

桌面控制工具：

- `ui_snapshot`：通过 Windows UI Automation 读取所有显示器上的窗口、控件、稳定编号和坐标
- `ui_click`：按编号/名称/类型自动定位并点击控件中心
- `screen_ocr`：截取全部显示器并调用 Windows.Media.Ocr
- `mouse_move` / `mouse_click` / `mouse_drag` / `mouse_scroll`
- `keyboard_type` / `keyboard_press`

首次桌面操作会请求一次“接管屏幕和鼠标”的确认；批准后本轮桌面操作直接执行。用户按 ESC 可随时中止任务。
