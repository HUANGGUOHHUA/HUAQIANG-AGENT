const require_explorer_focus = require("./chunks/explorer-focus-C_fpkGZh.js");
let node_fs_promises = require("node:fs/promises");
let node_fs = require("node:fs");
let node_child_process = require("node:child_process");
let node_net = require("node:net");
node_net = require_explorer_focus.__toESM(node_net);
//#region app/src/main/agent/tools/reveal.ts
function launch(target, forceNewWindow) {
	const args = forceNewWindow ? [
		"/c",
		"start",
		"",
		"explorer.exe",
		"/e,",
		target
	] : [
		"/c",
		"start",
		"",
		target
	];
	return new Promise((resolve, reject) => {
		const child = (0, node_child_process.spawn)("cmd.exe", args, {
			windowsHide: true,
			stdio: "ignore",
			detached: true
		});
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) resolve();
			else reject(/* @__PURE__ */ new Error(`启动资源管理器失败（退出码 ${code}）`));
		});
		child.unref();
	});
}
/** 在提权辅助进程里打开资源管理器，规避主进程被安全软件拦截的问题。 */
var revealTool = {
	name: "system_reveal",
	displayName: "打开资源管理器",
	risk: "read",
	description: "在工作区中打开文件夹或选中文件（内部使用）。",
	inputSchema: {
		type: "object",
		properties: {
			path: {
				type: "string",
				description: "要打开的绝对路径"
			},
			select: {
				type: "boolean",
				description: "是否在资源管理器中选中该文件"
			}
		},
		required: ["path"],
		additionalProperties: false
	},
	summarize: (args) => `打开 ${require_explorer_focus.stringArg(args, "path").slice(0, 120)}`,
	execute: async (args) => {
		const target = require_explorer_focus.stringArg(args, "path", { required: true });
		if (!target) throw new require_explorer_focus.ToolError("路径不能为空");
		const info = await (0, node_fs_promises.stat)(target).catch(() => null);
		const isDir = Boolean(info?.isDirectory());
		await launch(target, isDir);
		require_explorer_focus.focusExplorerWindow(target);
		return { output: isDir ? "opened in new window" : "opened" };
	}
};
//#endregion
//#region app/src/main/agent-worker.ts
function argValue(name) {
	const prefix = `--${name}=`;
	const hit = process.argv.find((item) => item.startsWith(prefix));
	return hit ? hit.slice(prefix.length) : "";
}
var pipeName = argValue("pipe");
var token = argValue("token");
var pythonPath = argValue("python");
var logFile = argValue("log");
function log(line) {
	if (!logFile) return;
	try {
		(0, node_fs.appendFileSync)(logFile, `[${(/* @__PURE__ */ new Date()).toISOString()}] worker ${line}\n`);
	} catch {}
}
if (!pipeName) {
	log("missing --pipe");
	process.exit(1);
}
var toolMap = new Map([
	...require_explorer_focus.createFileTools(),
	require_explorer_focus.runCommandTool,
	require_explorer_focus.systemInfoTool,
	require_explorer_focus.webFetchTool,
	revealTool
].map((tool) => [tool.name, tool]));
var workspace = "";
var builtin = new require_explorer_focus.BuiltinMcpService({
	workspace: () => workspace,
	pythonPath: () => pythonPath,
	version: "agent-worker"
});
var mcpClient = null;
async function ensureMcpClient() {
	if (mcpClient) return mcpClient;
	const transport = await builtin.start();
	const client = new require_explorer_focus.Client({
		name: "huaqiang-agent-worker",
		version: "1.0.0"
	}, { capabilities: {} });
	await client.connect(transport);
	mcpClient = client;
	return client;
}
var socket = node_net.default.connect(pipeName);
socket.setEncoding("utf8");
socket.on("connect", () => {
	log("connected");
	socket.write(`${JSON.stringify({
		type: "hello",
		token
	})}\n`);
});
socket.on("error", (error) => {
	log(`socket error: ${String(error)}`);
	process.exit(1);
});
socket.on("close", () => process.exit(0));
var pending = /* @__PURE__ */ new Map();
var buffer = "";
function send(payload) {
	try {
		socket.write(`${JSON.stringify(payload)}\n`);
	} catch {}
}
async function handle(message) {
	if (message.type === "cancel" && message.id) {
		pending.get(message.id)?.abort();
		return;
	}
	if (message.type !== "execute" || !message.id || !message.tool) return;
	const id = message.id;
	if (typeof message.workspace === "string" && message.workspace) workspace = message.workspace;
	const controller = new AbortController();
	pending.set(id, controller);
	try {
		const local = toolMap.get(message.tool);
		if (local) {
			const result = await local.execute(message.args ?? {}, {
				workspace,
				signal: controller.signal,
				onOutput: (chunk) => send({
					id,
					type: "output",
					chunk
				})
			});
			send({
				id,
				type: "result",
				output: result.output,
				isError: Boolean(result.isError),
				stats: result.stats
			});
		} else {
			const result = await (await ensureMcpClient()).callTool({
				name: message.tool,
				arguments: message.args ?? {}
			}, void 0, { timeout: 3e5 });
			send({
				id,
				type: "result",
				output: (Array.isArray(result.content) ? result.content : []).map((item) => {
					const block = item;
					return block && block.type === "text" ? String(block.text ?? "") : "";
				}).filter(Boolean).join("\n") || "(无输出)",
				isError: Boolean(result.isError)
			});
		}
	} catch (error) {
		send({
			id,
			type: "result",
			output: error instanceof Error ? error.message : String(error),
			isError: true
		});
	} finally {
		pending.delete(id);
	}
}
socket.on("data", (chunk) => {
	buffer += chunk;
	let index = buffer.indexOf("\n");
	while (index >= 0) {
		const line = buffer.slice(0, index);
		buffer = buffer.slice(index + 1);
		index = buffer.indexOf("\n");
		if (!line.trim()) continue;
		try {
			handle(JSON.parse(line));
		} catch {}
	}
});
log("started");
//#endregion
