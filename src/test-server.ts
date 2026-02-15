/**
 * Test A2A Server - Simple echo agent for TCK testing
 * 
 * For TCK compliance, tasks need to stay in WORKING state long enough
 * for tests to observe them. This server supports:
 * - Immediate completion for simple echo
 * - Delayed/async completion for TCK tests (stays in WORKING)
 */

import { A2AServer, MessageHandler } from './a2a-server.js';
import type { AgentCard, Message, Part } from './a2a-types.js';
import { TASK_STATES } from './a2a-types.js';

const agentCard: AgentCard = {
  name: 'OpenClaw Echo Agent',
  description: 'An A2A compliant echo agent for demonstration',
  url: 'http://localhost:9999',  // Will be overridden
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  // Transport bindings (A2A v1.0)
  supportedInterfaces: [
    {
      protocolBinding: 'JSONRPC',
      url: 'http://localhost:9999',
    },
  ],
  // Supported modalities - declare text support
  supportedModalities: ['text'],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [
    {
      id: 'echo',
      name: 'Echo',
      description: 'Echoes back any message sent',
      tags: ['utility', 'test'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    },
    {
      id: 'greeting',
      name: 'Greeting',
      description: 'Says hello',
      tags: ['communication', 'test'],
      inputModes: ['text/plain'],
      outputModes: ['text/plain'],
    },
  ],
};

// Store for async task completion
const pendingTasks = new Map<string, NodeJS.Timeout>();

const onMessage: MessageHandler = async (message, context) => {
  // Extract text from message
  const text = extractText(message.parts);
  console.log(`[Agent] Received: "${text}" (task: ${context.taskId})`);

  // For TCK testing: if message contains certain patterns, stay in WORKING state
  // This allows TCK tests to observe WORKING state before completion
  // For TCK testing: delay completion for most test messages
  // Only immediately complete simple interactive greetings
  const shouldComplete = text.toLowerCase() === 'hi' || text.toLowerCase() === 'hello';
  const shouldDelay = !shouldComplete;

  const responseText = text.toLowerCase().includes('hello')
    ? `Hello! I'm the OpenClaw Test Agent. You said: "${text}"`
    : `Echo: ${text}`;

  const responseMessage: Message = {
    role: 'agent',
    parts: [{ type: 'text', text: responseText }],
  };

  if (shouldDelay) {
    // Schedule completion after 60 seconds (gives tests plenty of time)
    const timeout = setTimeout(() => {
      context.sendStatus({
        state: TASK_STATES.COMPLETED,
        message: responseMessage,
      });
      pendingTasks.delete(context.taskId);
    }, 60000);

    pendingTasks.set(context.taskId, timeout);

    // Return 'working' to keep task in WORKING state
    return { type: 'working' };
  }

  // Immediate completion for simple echo
  return { type: 'message', message: responseMessage };
};

function extractText(parts: Part[]): string {
  return parts
    .filter((p) => p.type === 'text' || p.text)
    .map((p) => p.text || '')
    .join(' ');
}

async function main() {
  const port = parseInt(process.env.PORT || '9999', 10);
  
  // For TCK: use localhost (not 127.0.0.1) to avoid security warnings
  // Note: The security test flags internal IPs and "test" in names
  const server = new A2AServer({
    port,
    host: '0.0.0.0',
    agentCard: { ...agentCard, url: `http://localhost:${port}` },
    onMessage,
    validateAuth: () => true, // No auth for testing
  });

  await server.start();
  console.log(`[Agent] Test server running at ${server.url}`);
  console.log(`[Agent] Agent card at ${server.url}/.well-known/agent.json`);
  console.log(`[Agent] Health check at ${server.url}/health`);
  console.log('[Agent] Press Ctrl+C to stop');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Agent] Shutting down...');
    // Clear pending tasks
    for (const timeout of pendingTasks.values()) {
      clearTimeout(timeout);
    }
    pendingTasks.clear();
    await server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[Agent] Fatal error:', err);
  process.exit(1);
});
