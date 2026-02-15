/**
 * Integration tests for the A2A relay flow.
 * 
 * These tests verify the end-to-end CUJ:
 * Client → Relay → Agent → Response
 * 
 * Requires: A2A relay running and accessible
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RelayClient, createTestToken } from './relay-client.js';
import type { AgentCard, JsonRpcRequest, JsonRpcResponse } from './a2a-types.js';
import { TASK_STATES } from './a2a-types.js';

// Test configuration - uses local relay by default
const RELAY_URL = process.env.TEST_RELAY_URL || 'ws://localhost:8765/agent';
const RELAY_SECRET = process.env.TEST_RELAY_SECRET || 'test-secret';
const TENANT = 'test';
const AGENT_ID = 'integration-test-agent';

// Simple echo agent for testing
const testAgentCard: AgentCard = {
  name: 'Integration Test Agent',
  description: 'Echo agent for integration tests',
  url: `a2a-relay://localhost/t/${TENANT}/${AGENT_ID}`,
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: false },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'echo', name: 'Echo', description: 'Echoes messages' }],
};

// Skip if no relay available
const shouldRun = process.env.TEST_WITH_RELAY === 'true';

describe.skipIf(!shouldRun)('Relay Integration', () => {
  let client: RelayClient;
  let receivedRequests: JsonRpcRequest[] = [];

  beforeAll(async () => {
    const token = createTestToken({
      tenant: TENANT,
      agent_id: AGENT_ID,
      role: 'agent',
    }, RELAY_SECRET);

    client = new RelayClient({
      relayUrl: RELAY_URL,
      token,
      tenant: TENANT,
      agentId: AGENT_ID,
      agentCard: testAgentCard,
      onRequest: async (request): Promise<JsonRpcResponse> => {
        receivedRequests.push(request);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            task: {
              id: 'test-task-1',
              status: { state: TASK_STATES.COMPLETED },
            },
          },
        };
      },
      autoReconnect: false,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
  });

  it('should connect to relay', () => {
    expect(client.connected).toBe(true);
  });

  it('should have received no requests yet', () => {
    expect(receivedRequests).toHaveLength(0);
  });
});

// Unit tests that don't require relay
describe('Token Creation', () => {
  it('should create valid JWT tokens', () => {
    const token = createTestToken({
      tenant: 'test',
      agent_id: 'my-agent',
      role: 'agent',
    }, 'test-secret-32-chars-minimum-length');

    expect(token).toMatch(/^eyJ/); // JWT header starts with eyJ
    expect(token.split('.')).toHaveLength(3); // JWT has 3 parts
  });

  it('should include required claims', () => {
    const jwt = require('jsonwebtoken');
    const secret = 'test-secret-32-chars-minimum-length';
    const token = createTestToken({
      tenant: 'my-tenant',
      agent_id: 'my-agent',
      role: 'agent',
    }, secret);

    const decoded = jwt.verify(token, secret) as any;
    expect(decoded.tenant).toBe('my-tenant');
    expect(decoded.agent_id).toBe('my-agent');
    expect(decoded.role).toBe('agent');
    expect(decoded.exp).toBeGreaterThan(Date.now() / 1000);
  });
});

describe('Agent Card', () => {
  it('should have required fields', () => {
    expect(testAgentCard.name).toBeDefined();
    expect(testAgentCard.url).toBeDefined();
    expect(testAgentCard.version).toBeDefined();
    expect(testAgentCard.capabilities).toBeDefined();
  });
});
