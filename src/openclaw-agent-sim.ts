/**
 * OpenClaw Agent Simulator - Simulates OpenClaw behavior for testing
 * 
 * This agent simulates what the real OpenClaw Gateway would do when 
 * integrated with A2A. Used to test the full CUJ before implementing
 * the actual Gateway plugin.
 * 
 * Usage:
 *   RELAY_URL=wss://relay.example.com/agent \
 *   RELAY_SECRET=your-secret \
 *   RELAY_TENANT=personal \
 *   RELAY_AGENT_ID=zaf \
 *   node dist/openclaw-agent-sim.js
 */

import { RelayClient, createTestToken } from './relay-client.js';
import type { AgentCard, JsonRpcRequest, JsonRpcResponse, Message } from './a2a-types.js';
import { A2A_ERROR_CODES, JSONRPC_ERROR_CODES, TASK_STATES } from './a2a-types.js';
import { randomUUID } from 'crypto';

// Configuration from environment
const RELAY_URL = process.env.RELAY_URL || 'wss://a2a-relay-dev-442090395636.us-central1.run.app/agent';
const RELAY_SECRET = process.env.RELAY_SECRET || 'dev-secret-change-me';
const RELAY_TENANT = process.env.RELAY_TENANT || 'test';
const RELAY_AGENT_ID = process.env.RELAY_AGENT_ID || 'zaf';

// In-memory task storage
const tasks = new Map<string, any>();

// Simulated state
const simulatedState = {
  currentTasks: ['Build A2A stack', 'Review PRs', 'Write documentation'],
  recentActivity: [
    'Committed A2A client code',
    'Fixed audio playback bug',
    'Deployed relay to Cloud Run',
  ],
  personality: {
    name: 'Zaf',
    style: 'terse, friendly, nerdy',
  }
};

// Agent card - matches what OpenClaw would expose
const agentCard: AgentCard = {
  name: 'Zaf (OpenClaw Simulator)',
  description: 'AI assistant simulating OpenClaw behavior for A2A testing',
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
  skills: [
    { id: 'chat', name: 'Chat', description: 'General conversation' },
    { id: 'tasks', name: 'Task Management', description: 'List and manage tasks' },
    { id: 'status', name: 'Status', description: 'Get current status' },
  ],
};

// Simulate OpenClaw's response generation
function generateResponse(userMessage: string): string {
  const msg = userMessage.toLowerCase();
  
  // Status queries
  if (msg.includes('status') || msg.includes('what are you doing') || msg.includes('working on')) {
    const taskList = simulatedState.currentTasks.map(t => `  - ${t}`).join('\n');
    return `Hey! Here's what I'm working on:\n\n${taskList}\n\nMost recent: ${simulatedState.recentActivity[0]}`;
  }
  
  // Task listing
  if (msg.includes('list tasks') || msg.includes('show tasks') || msg.includes('tasks')) {
    return `Current tasks:\n${simulatedState.currentTasks.map(t => `  ✓ ${t}`).join('\n')}`;
  }
  
  // Identity questions
  if (msg.includes('who are you') || msg.includes('your name')) {
    return `I'm ${simulatedState.personality.name}! An AI assistant running on OpenClaw. ${simulatedState.personality.style} vibes. 🦎`;
  }
  
  // Greetings
  if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey')) {
    return `Hey! What's up? 👋`;
  }
  
  // Help
  if (msg.includes('help')) {
    return `I can help with:
  - Checking status ("what are you working on?")
  - Listing tasks ("show tasks")
  - General questions

Just ask!`;
  }
  
  // Default conversational response
  return `Got it: "${userMessage.slice(0, 50)}${userMessage.length > 50 ? '...' : ''}" — I'll think about that. (This is a simulated response — real OpenClaw integration coming soon!)`;
}

// Request handler
async function handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { method, params, id } = request;

  console.log(`[OpenClaw-Sim] Handling ${method}`);

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

  console.log(`[OpenClaw-Sim] User says: "${text}"`);

  // Generate response
  const responseText = generateResponse(text);
  console.log(`[OpenClaw-Sim] Responding: "${responseText.slice(0, 50)}..."`);

  // Create task
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
    metadata: {
      agentName: simulatedState.personality.name,
      simulated: true,
    }
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
  console.log('[OpenClaw-Sim] Starting OpenClaw agent simulator...');
  console.log(`[OpenClaw-Sim] Relay: ${RELAY_URL}`);
  console.log(`[OpenClaw-Sim] Tenant: ${RELAY_TENANT}`);
  console.log(`[OpenClaw-Sim] Agent ID: ${RELAY_AGENT_ID}`);

  // Create JWT token
  const token = createTestToken({
    tenant: RELAY_TENANT,
    agent_id: RELAY_AGENT_ID,
    role: 'agent',
  }, RELAY_SECRET);

  console.log('[OpenClaw-Sim] Token created');

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
    console.log('[OpenClaw-Sim] Connected to relay! Ready for requests.');
    console.log(`[OpenClaw-Sim] Accessible at: https://${new URL(RELAY_URL).host}/t/${RELAY_TENANT}/a2a/${RELAY_AGENT_ID}`);
    console.log('[OpenClaw-Sim]');
    console.log('[OpenClaw-Sim] Try: "What are you working on?", "help", "show tasks"');
  } catch (err) {
    console.error('[OpenClaw-Sim] Failed to connect:', err);
    process.exit(1);
  }

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n[OpenClaw-Sim] Shutting down...');
    await client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
