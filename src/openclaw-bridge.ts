/**
 * OpenClaw A2A Bridge - Connects A2A relay to OpenClaw Gateway
 * 
 * This is a bridge/proof-of-concept that forwards A2A messages to OpenClaw
 * via the sessions_send API. In production, this would be a Gateway plugin.
 * 
 * Flow:
 * 1. Client sends A2A message/send to relay
 * 2. Relay forwards to this bridge (via WebSocket)
 * 3. Bridge calls OpenClaw Gateway API to send message to session
 * 4. Bridge returns OpenClaw's response as A2A Task
 * 
 * Usage:
 *   RELAY_SECRET=... OPENCLAW_URL=... node dist/openclaw-bridge.js
 */

import { RelayClient, createTestToken } from './relay-client.js';
import type { AgentCard, JsonRpcRequest, JsonRpcResponse, Message } from './a2a-types.js';
import { JSONRPC_ERROR_CODES, TASK_STATES } from './a2a-types.js';
import { randomUUID } from 'crypto';

// Configuration
const RELAY_URL = process.env.RELAY_URL || 'wss://a2a-relay-dev-442090395636.us-central1.run.app/agent';
const RELAY_SECRET = process.env.RELAY_SECRET!;
const RELAY_TENANT = process.env.RELAY_TENANT || 'test';
const RELAY_AGENT_ID = process.env.RELAY_AGENT_ID || 'zaf';

// OpenClaw Gateway API
const OPENCLAW_URL = process.env.OPENCLAW_URL || 'http://localhost:3000';
const OPENCLAW_TOKEN = process.env.OPENCLAW_TOKEN || '';

// In-memory task storage
const tasks = new Map<string, any>();

// Agent card
const agentCard: AgentCard = {
  name: 'Zaf (OpenClaw Bridge)',
  description: 'AI assistant connected via A2A bridge to OpenClaw Gateway',
  url: `a2a-relay://${new URL(RELAY_URL).host}/t/${RELAY_TENANT}/${RELAY_AGENT_ID}`,
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    { id: 'chat', name: 'Chat', description: 'General conversation' },
    { id: 'tasks', name: 'Task Management', description: 'Manage tasks and plans' },
    { id: 'code', name: 'Coding', description: 'Software development assistance' },
  ],
};

/**
 * Forward message to OpenClaw Gateway and get response
 */
async function forwardToOpenClaw(message: string, contextId?: string): Promise<string> {
  // For now, we'll use a simple HTTP endpoint
  // In production, this would use the Gateway's internal API
  
  const sessionKey = contextId ? `agent:main:a2a:${contextId}` : 'agent:main:main';
  
  console.log(`[Bridge] Forwarding to OpenClaw session: ${sessionKey}`);
  console.log(`[Bridge] Message: ${message.slice(0, 100)}...`);
  
  try {
    // Try to call OpenClaw's sessions_send equivalent
    // This is a placeholder - need to implement proper Gateway API call
    const response = await fetch(`${OPENCLAW_URL}/api/sessions/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(OPENCLAW_TOKEN ? { 'Authorization': `Bearer ${OPENCLAW_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        sessionKey,
        message,
        timeoutSeconds: 60,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`[Bridge] OpenClaw error: ${error}`);
      return `[Bridge error: ${response.status}] Unable to reach OpenClaw Gateway. Message was: ${message}`;
    }

    const result = await response.json();
    return result.response || result.message || JSON.stringify(result);
  } catch (error) {
    console.error(`[Bridge] Failed to forward:`, error);
    
    // Fallback: acknowledge receipt but note we couldn't process
    return `[Bridge] Received your message but couldn't forward to OpenClaw: ${error}. Message was: "${message.slice(0, 200)}"`;
  }
}

// Request handler
async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { method, params, id } = request;

  console.log(`[Bridge] Handling ${method}`);

  switch (method) {
    case 'message/send':
      return handleMessageSend(id, params);
    
    case 'tasks/get':
      return handleTasksGet(id, params);
    
    case 'tasks/list':
      return handleTasksList(id, params);
    
    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, message: `Unknown method: ${method}` },
      };
  }
}

async function handleMessageSend(id: any, params: any): Promise<JsonRpcResponse> {
  const message = params?.message;
  if (!message || !message.parts) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: JSONRPC_ERROR_CODES.INVALID_PARAMS, message: 'Missing message.parts' },
    };
  }

  // Extract text from message
  const text = message.parts
    .filter((p: any) => p.type === 'text' || p.text)
    .map((p: any) => p.text)
    .join(' ');

  console.log(`[Bridge] Received: "${text.slice(0, 100)}..."`);

  // Forward to OpenClaw
  const responseText = await forwardToOpenClaw(text, message.contextId);

  // Create A2A Task response
  const taskId = randomUUID();
  const contextId = message.contextId || randomUUID();
  
  const responseMessage: Message = {
    role: 'agent',
    parts: [{ type: 'text', text: responseText }],
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
  const task = tasks.get(taskId);
  
  if (!task) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32001, message: 'Task not found' },
    };
  }

  return { jsonrpc: '2.0', id, result: task };
}

function handleTasksList(id: any, _params: any): JsonRpcResponse {
  const allTasks = Array.from(tasks.values());
  return {
    jsonrpc: '2.0',
    id,
    result: {
      tasks: allTasks.slice(-100), // Last 100 tasks
      totalSize: allTasks.length,
    },
  };
}

// Main
async function main() {
  if (!RELAY_SECRET) {
    console.error('[Bridge] RELAY_SECRET is required');
    process.exit(1);
  }

  console.log('[Bridge] Starting OpenClaw A2A Bridge...');
  console.log(`[Bridge] Relay: ${RELAY_URL}`);
  console.log(`[Bridge] Tenant: ${RELAY_TENANT}`);
  console.log(`[Bridge] Agent ID: ${RELAY_AGENT_ID}`);
  console.log(`[Bridge] OpenClaw: ${OPENCLAW_URL}`);

  const token = createTestToken({
    tenant: RELAY_TENANT,
    agent_id: RELAY_AGENT_ID,
    role: 'agent',
  }, RELAY_SECRET);

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
    console.log('[Bridge] Connected! Waiting for A2A requests...');
    console.log(`[Bridge] Accessible at: https://${new URL(RELAY_URL).host}/t/${RELAY_TENANT}/a2a/${RELAY_AGENT_ID}`);
  } catch (err) {
    console.error('[Bridge] Failed to connect:', err);
    process.exit(1);
  }

  process.on('SIGINT', async () => {
    console.log('\n[Bridge] Shutting down...');
    await client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
