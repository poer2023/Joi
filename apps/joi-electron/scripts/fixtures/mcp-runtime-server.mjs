import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'joi-mcp-runtime-fixture', version: '1.0.0' });

server.registerTool('echo', {
  title: 'Echo',
  description: 'Echo input through a real MCP tool call.',
  inputSchema: { text: z.string() },
}, async ({ text }) => ({
  content: [{ type: 'text', text: `echo:${text}` }],
  structuredContent: { echoed: text },
}));

server.registerResource('fixture', new ResourceTemplate('fixture://{name}', { list: undefined }), {
  title: 'Fixture Resource',
  description: 'A fixture MCP resource.',
  mimeType: 'text/plain',
}, async (uri, { name }) => ({ contents: [{ uri: uri.href, text: `resource:${name}` }] }));

server.registerResource('fixture-root', 'fixture://root', {
  title: 'Fixture Root',
  description: 'A listable fixture MCP resource.',
  mimeType: 'text/plain',
}, async (uri) => ({ contents: [{ uri: uri.href, text: 'resource:root' }] }));

server.registerPrompt('summarize', {
  title: 'Summarize',
  description: 'Fixture prompt.',
  argsSchema: { text: z.string() },
}, ({ text }) => ({ messages: [{ role: 'user', content: { type: 'text', text: `Summarize: ${text}` } }] }));

await server.connect(new StdioServerTransport());
