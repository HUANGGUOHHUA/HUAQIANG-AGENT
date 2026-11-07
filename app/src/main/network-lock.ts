import type { ToolDefinition } from './agent/tools/types'
import { NETWORK_LOCKED_ERROR, state } from './state'

const NETWORK_COMMAND_RE =
  /(https?:\/\/|ftp:\/\/|\bcurl\b|\bwget\b|Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|Test-NetConnection|Resolve-DnsName|\bnslookup\b|\bping\b|\bssh\b|\bscp\b|\bftp\b|git\s+clone|npm\s+(install|i)\b|pnpm\s+(add|install)\b|yarn\s+add\b|pip\s+install|winget\s+install|choco\s+install|\bpython\b[^\n]*-m\s+pip|node\s+[^\n]*fetch)/i

/**
 * 断网锁：模型 API 不经过这里，但网页抓取、下载类命令一律拒绝。
 * 只包装真正联网的两个工具，其余原样透传。
 */
export function withNetworkLock(tool: ToolDefinition): ToolDefinition {
  if (tool.name !== 'web_fetch' && tool.name !== 'run_command') return tool
  return {
    ...tool,
    execute: async (args, context) => {
      if (!state.settings.getRaw().networkLocked) return tool.execute(args, context)
      if (tool.name === 'web_fetch') throw new Error(NETWORK_LOCKED_ERROR)
      const command = typeof args.command === 'string' ? args.command : ''
      if (NETWORK_COMMAND_RE.test(command)) throw new Error(NETWORK_LOCKED_ERROR)
      return tool.execute(args, context)
    }
  }
}
