let electron = require("electron");
//#region app/src/preload/index.ts
electron.contextBridge.exposeInMainWorld("hq", {
	info: () => electron.ipcRenderer.invoke("app:info"),
	getSettings: () => electron.ipcRenderer.invoke("settings:get"),
	saveSettings: (input) => electron.ipcRenderer.invoke("settings:save", input),
	chooseWorkspace: () => electron.ipcRenderer.invoke("workspace:choose"),
	testProfile: (input) => electron.ipcRenderer.invoke("profile:test", input),
	listProfileModels: (input) => electron.ipcRenderer.invoke("profile:models", input),
	listSessions: () => electron.ipcRenderer.invoke("sessions:list"),
	loadSession: (id) => electron.ipcRenderer.invoke("sessions:load", id),
	saveSession: (session) => electron.ipcRenderer.invoke("sessions:save", session),
	deleteSession: (id) => electron.ipcRenderer.invoke("sessions:delete", id),
	runAgent: (input) => electron.ipcRenderer.invoke("agent:run", input),
	compactConversation: (input) => electron.ipcRenderer.invoke("agent:compact", input),
	abortAgent: (runId) => electron.ipcRenderer.invoke("agent:abort", runId),
	approveTool: (requestId, decision) => electron.ipcRenderer.invoke("agent:approve", requestId, decision),
	onAgentEvent: (listener) => {
		const handler = (_event, payload) => listener(payload);
		electron.ipcRenderer.on("agent:event", handler);
		return () => electron.ipcRenderer.removeListener("agent:event", handler);
	},
	onBrowserCommand: (listener) => {
		const handler = (_event, cmd) => listener(cmd);
		electron.ipcRenderer.on("browser:command", handler);
		return () => electron.ipcRenderer.removeListener("browser:command", handler);
	},
	browserResult: (result) => electron.ipcRenderer.invoke("browser:result", result),
	onAppCommand: (listener) => {
		const handler = (_event, cmd) => listener(cmd);
		electron.ipcRenderer.on("app:command", handler);
		return () => electron.ipcRenderer.removeListener("app:command", handler);
	},
	appControlResult: (result) => electron.ipcRenderer.invoke("app:result", result),
	captureScreenshot: () => electron.ipcRenderer.invoke("screenshot:capture"),
	requestElevation: () => electron.ipcRenderer.invoke("app:elevate"),
	filePath: (file) => {
		try {
			return electron.webUtils.getPathForFile(file);
		} catch {
			return "";
		}
	},
	setZoom: (factor) => electron.ipcRenderer.invoke("window:setZoom", factor),
	getZoom: () => electron.ipcRenderer.invoke("window:getZoom"),
	setFullscreen: (value) => electron.ipcRenderer.invoke("window:setFullscreen", value),
	workspaceList: (path) => electron.ipcRenderer.invoke("workspace:list", path),
	workspaceRead: (path) => electron.ipcRenderer.invoke("workspace:read", path),
	workspaceReadAsset: (path) => electron.ipcRenderer.invoke("workspace:readAsset", path),
	workspaceExtract: (path) => electron.ipcRenderer.invoke("workspace:extract", path),
	workspaceOcr: (path) => electron.ipcRenderer.invoke("workspace:ocr", path),
	pythonStatus: () => electron.ipcRenderer.invoke("python:status"),
	pythonSetup: () => electron.ipcRenderer.invoke("python:setup"),
	pickAttachments: () => electron.ipcRenderer.invoke("attachments:pick"),
	readDroppedAttachments: (paths) => electron.ipcRenderer.invoke("attachments:readPaths", paths),
	workspaceWrite: (path, content) => electron.ipcRenderer.invoke("workspace:write", path, content),
	workspaceReveal: (path) => electron.ipcRenderer.invoke("workspace:reveal", path),
	workspaceOpen: (path) => electron.ipcRenderer.invoke("workspace:open", path),
	workspaceOpenWith: (path) => electron.ipcRenderer.invoke("workspace:openWith", path),
	workspaceOpenOffice: (path) => electron.ipcRenderer.invoke("workspace:openOffice", path),
	mcpStatuses: () => electron.ipcRenderer.invoke("mcp:statuses"),
	mcpRestart: () => electron.ipcRenderer.invoke("mcp:restart"),
	mcpTest: (config) => electron.ipcRenderer.invoke("mcp:test", config),
	openExternal: (url) => electron.ipcRenderer.invoke("app:openExternal", url),
	openDataFolder: () => electron.ipcRenderer.invoke("app:openDataFolder"),
	minimizeWindow: () => electron.ipcRenderer.invoke("window:minimize"),
	toggleMaximize: () => electron.ipcRenderer.invoke("window:toggleMaximize"),
	closeWindow: () => electron.ipcRenderer.invoke("window:close"),
	isMaximized: () => electron.ipcRenderer.invoke("window:isMaximized"),
	onWindowState: (listener) => {
		const handler = (_event, maximized) => listener(maximized);
		electron.ipcRenderer.on("window:state", handler);
		return () => electron.ipcRenderer.removeListener("window:state", handler);
	}
});
//#endregion
