/**
 * Test Agent - Connects to relay and handles A2A requests
 * 
 * Usage:
 *   RELAY_URL=wss://relay.example.com/agent \
 *   RELAY_SECRET=your-secret \
 *   RELAY_TENANT=personal \
 *   RELAY_AGENT_ID=test-agent \
 *   node dist/test-relay-agent.js
 */

import { RelayClient, createTestToken } from './relay-client.js';
import type { AgentCard, JsonRpcRequest, JsonRpcResponse, Message } from './a2a-types.js';
import { A2A_ERROR_CODES, JSONRPC_ERROR_CODES, TASK_STATES } from './a2a-types.js';
import { randomUUID } from 'crypto';

// Configuration from environment
const RELAY_URL = process.env.RELAY_URL || 'wss://a2a-relay-dev-442090395636.us-central1.run.app/agent';
const RELAY_SECRET = process.env.RELAY_SECRET || 'dev-secret-change-me';
const RELAY_TENANT = process.env.RELAY_TENANT || 'test';
const RELAY_AGENT_ID = process.env.RELAY_AGENT_ID || 'echo-agent';

// In-memory task storage
const tasks = new Map<string, any>();

// Agent card
const agentCard: AgentCard = {
  name: 'Echo Test Agent',
  description: 'A simple echo agent for testing relay connections',
  url: `a2a-relay://${new URL(RELAY_URL).host}/t/${RELAY_TENANT}/${RELAY_AGENT_ID}`,
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  supportedInterfaces: [{
    protocolBinding: 'JSONRPC',
    url: `https://${new URL(RELAY_URL).host}/t/${RELAY_TENANT}/a2a/${RELAY_AGENT_ID}`,
  }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{
    id: 'echo',
    name: 'Echo',
    description: 'Echoes back any message',
    tags: ['test'],
  }],
};

// Request handler
async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { method, params, id } = request;

  console.log(`[Agent] Handling ${method}`);

  switch (method) {
    case 'message/send':
      return handleMessageSend(id, params);
    
    case 'tasks/get':
      return handleTasksGet(id, params);
    
    case 'tasks/list':
      return handleTasksList(id, params);
    
    case 'tasks/cancel':
      return handleTasksCancel(id, params);
    
    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, message: `Unknown method: ${method}` },
      };
  }
}

function handleMessageSend(id: any, params: any): JsonRpcResponse {
  const message = params?.message;
  if (!message || !message.parts) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: JSONRPC_ERROR_CODES.INVALID_PARAMS, message: 'Missing message.parts' },
    };
  }

  // Extract text
  const text = message.parts
    .filter((p: any) => p.type === 'text' || p.text)
    .map((p: any) => p.text)
    .join(' ');

  console.log(`[Agent] Received: "${text}"`);

  // Create task
  const taskId = randomUUID();
  const contextId = message.contextId || randomUUID();
  
  // Echo response
  const responseMessage: Message = {
    role: 'agent',
    parts: [{ type: 'text', text: `Echo: ${text}` }],
  };

  const task = {
    id: taskId,
    contextId,
    status: {
      state: TASK_STATES.COMPLETED,
      message: responseMessage,
      timestamp: new Date().toISOString(),
    },
    history: [message, responseMessage],
    artifacts: [],
  };

  tasks.set(taskId, task);

  return {
    jsonrpc: '2.0',
    id,
    result: { task },
  };
}

function handleTasksGet(id: any, params: any): JsonRpcResponse {
  const taskId = params?.id;
  if (!taskId) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: JSONRPC_ERROR_CODES.INVALID_PARAMS, message: 'Missing task id' },
    };
  }

  const task = tasks.get(taskId);
  if (!task) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: 'Task not found' },
    };
  }

  return { jsonrpc: '2.0', id, result: task };
}

function handleTasksList(id: any, params: any): JsonRpcResponse {
  const allTasks = Array.from(tasks.values());
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tasks: allTasks,
      nextPageToken: '',
      pageSize: allTasks.length,
      totalSize: allTasks.length,
    },
  };
}

function handleTasksCancel(id: any, params: any): JsonRpcResponse {
  const taskId = params?.id;
  const task = tasks.get(taskId);
  
  if (!task) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: A2A_ERROR_CODES.TASK_NOT_FOUND, message: 'Task not found' },
    };
  }

  task.status = { state: TASK_STATES.CANCELED, timestamp: new Date().toISOString() };
  return { jsonrpc: '2.0', id, result: task };
}

// Main
async function main() {
  console.log('[Agent] Starting relay-connected test agent...');
  console.log(`[Agent] Relay: ${RELAY_URL}`);
  console.log(`[Agent] Tenant: ${RELAY_TENANT}`);
  console.log(`[Agent] Agent ID: ${RELAY_AGENT_ID}`);

  // Create JWT token
  const token = createTestToken({
    tenant: RELAY_TENANT,
    agent_id: RELAY_AGENT_ID,
    role: 'agent',
  }, RELAY_SECRET);

  console.log('[Agent] Token created');

  // Connect to relay
  const client = new RelayClient({
    relayUrl: RELAY_URL,
    token,
    tenant: RELAY_TENANT,
    agentId: RELAY_AGENT_ID,
    agentCard,
    onRequest: handleRequest,
    autoReconnect: true,
  });

  try {
    await client.connect();
    console.log('[Agent] Connected to relay! Waiting for requests...');
    console.log(`[Agent] Accessible at: https://${new URL(RELAY_URL).host}/t/${RELAY_TENANT}/a2a/${RELAY_AGENT_ID}`);
  } catch (err) {
    console.error('[Agent] Failed to connect:', err);
    process.exit(1);
  }

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Agent] Shutting down...');
    await client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
