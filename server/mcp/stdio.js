#!/usr/bin/env node
// Stdio MCP server for Claude Desktop / Claude Code / any MCP client.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './tools.js';
import { closeAll } from '../mail/pool.js';
import { log } from '../config.js';

const server = createMcpServer();
await server.connect(new StdioServerTransport());
log.info('AskCruz Mailbox MCP server running on stdio');

const shutdown = async () => {
  await closeAll();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.stdin.on('close', shutdown);
