import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema
} from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'mock-hq-mcp', version: '1.0.0' },
  { capabilities: { tools: {}, resources: {}, prompts: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'echo',
      description: 'Echo text back for tests',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false
      }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: 'text', text: `echo:${String(request.params.arguments?.text ?? '')}` }]
}))

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'mock://readme',
      name: 'Mock README',
      description: 'A test resource',
      mimeType: 'text/plain'
    }
  ]
}))

server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
  contents: [
    {
      uri: request.params.uri,
      mimeType: 'text/plain',
      text: 'resource-body'
    }
  ]
}))

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [{ name: 'mock-prompt', description: 'A test prompt' }]
}))

server.setRequestHandler(GetPromptRequestSchema, async (request) => ({
  description: 'A test prompt',
  messages: [
    {
      role: 'user',
      content: { type: 'text', text: `prompt:${String(request.params.name)}` }
    }
  ]
}))

await server.connect(new StdioServerTransport())
