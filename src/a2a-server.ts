/**
 * A2A Server - HTTP server implementing A2A JSON-RPC protocol (v1.0 RC)
 * 
 * This can be used standalone or integrated into OpenClaw Gateway.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  AgentCard,
  Task,
  TaskState,
  TaskStatus,
  Message,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  SendMessageRequest,
  SendMessageResponse,
  GetTaskRequest,
  CancelTaskRequest,
  ListTasksRequest,
  ListTasksResponse,
  Artifact,
} from './a2a-types.js';
import { A2A_ERROR_CODES, JSONRPC_ERROR_CODES, TASK_STATES, VALID_TASK_STATES } from './a2a-types.js';

// ============================================================================
// Types
// ============================================================================

export interface A2AServerConfig {
  port?: number;
  host?: string;
  agentCard: AgentCard;
  /** Handler for incoming messages - implement your agent logic here */
  onMessage: MessageHandler;
  /** Optional auth validator */
  validateAuth?: (authHeader: string | undefined) => boolean;
}

export type MessageHandler = (
  message: Message,
  context: MessageContext
) => Promise<MessageResult> | MessageResult;

export interface MessageContext {
  taskId: string;
  contextId?: string;
  sendStatus: (status: TaskStatus) => void;
  sendArtifact: (artifact: Artifact) => void;
}

export type MessageResult = 
  | { type: 'message'; message: Message }  // Complete task with this message
  | { type: 'task'; task: Task }           // Return this task (for custom state)
  | { type: 'working' };                   // Keep task in WORKING state (async completion)

// Terminal states where tasks cannot be canceled or receive more messages
const TERMINAL_STATES = new Set<TaskState>([
  'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED',
  'completed', 'failed', 'canceled', 'rejected',
]);

// ============================================================================
// A2A Server Implementation
// ============================================================================

export class A2AServer {
  private server: ReturnType<typeof createServer> | null = null;
  private tasks = new Map<string, Task>();
  private config: Required<A2AServerConfig>;

  constructor(config: A2AServerConfig) {
    this.config = {
      port: 8080,
      host: '0.0.0.0',
      validateAuth: () => true,
      ...config,
    };
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.config.port, this.config.host, () => {
        console.log(`[A2A] Server listening on ${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  get url(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  /** Clear all tasks (useful for testing) */
  clearTasks(): void {
    this.tasks.clear();
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, A2A-Version, A2A-Extensions');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    
    try {
      // Agent Card endpoint (support both v0.3.0 and v0.2.x paths)
      if ((url.pathname === '/.well-known/agent-card.json' || 
           url.pathname === '/.well-known/agent.json') && req.method === 'GET') {
        await this.handleAgentCard(req, res);
        return;
      }

      // JSON-RPC endpoint (POST to root or /rpc)
      if ((url.pathname === '/' || url.pathname === '/rpc') && req.method === 'POST') {
        await this.handleJsonRpc(req, res);
        return;
      }

      // Health check
      if (url.pathname === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', tasks: this.tasks.size }));
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      console.error('[A2A] Request error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private async handleAgentCard(_req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(this.config.agentCard));
  }

  private async handleJsonRpc(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Auth check
    if (!this.config.validateAuth(req.headers.authorization)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.jsonRpcError(null, JSONRPC_ERROR_CODES.INTERNAL_ERROR, 'Unauthorized')));
      return;
    }

    // Parse body
    const body = await this.readBody(req);
    let parsed: unknown;

    try {
      parsed = JSON.parse(body);
    } catch {
      // JSON-RPC spec: return 200 with error for parse errors
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.jsonRpcError(null, JSONRPC_ERROR_CODES.PARSE_ERROR, 'Parse error')));
      return;
    }

    // Validate JSON-RPC structure
    const validation = this.validateJsonRpcRequestDetailed(parsed);
    if (!validation.valid) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.jsonRpcError(
        validation.id,
        validation.code,
        validation.message
      )));
      return;
    }

    const request = parsed as JsonRpcRequest;

    // Route to method handler
    const response = await this.routeMethod(request);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  private async routeMethod(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { method, params, id } = request;

    try {
      // Normalize method names (support both slash and camelCase formats)
      const normalizedMethod = this.normalizeMethodName(method);

      switch (normalizedMethod) {
        case 'message/send':
          return this.handleMessageSend(id, params as SendMessageRequest);

        case 'tasks/get':
          return this.handleTasksGet(id, params as GetTaskRequest);

        case 'tasks/cancel':
          return this.handleTasksCancel(id, params as CancelTaskRequest);

        case 'tasks/list':
          return this.handleTasksList(id, params as ListTasksRequest);

        case 'agent/card':
          return this.jsonRpcSuccess(id, this.config.agentCard);

        default:
          return this.jsonRpcError(id, JSONRPC_ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (err) {
      console.error(`[A2A] Method ${method} error:`, err);
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INTERNAL_ERROR, String(err));
    }
  }

  private async handleMessageSend(id: string | number, params: SendMessageRequest): Promise<JsonRpcResponse> {
    // Validate params structure
    if (!params || typeof params !== 'object') {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Invalid params');
    }
    if (!params.message) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Missing message');
    }
    if (typeof params.message !== 'object') {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Invalid message structure');
    }
    // Validate required message fields per v1.0 spec
    if (!params.message.parts || !Array.isArray(params.message.parts)) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Missing or invalid message.parts');
    }
    // TCK quality test: empty parts array should be rejected
    if (params.message.parts.length === 0) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Message parts array must not be empty');
    }
    if (!params.message.role) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Missing message.role');
    }
    if (!params.message.messageId) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Missing message.messageId');
    }

    // Extract taskId/contextId from message (per A2A v1.0 spec)
    const messageTaskId = params.message.taskId;
    const messageContextId = params.message.contextId;

    // If taskId provided, check it exists and is not in terminal state
    let existingTask: Task | undefined;
    if (messageTaskId) {
      existingTask = this.tasks.get(messageTaskId);
      if (!existingTask) {
        return this.jsonRpcError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found');
      }
      if (TERMINAL_STATES.has(existingTask.status.state)) {
        return this.jsonRpcError(id, A2A_ERROR_CODES.UNSUPPORTED_OPERATION, 'Task is in terminal state');
      }
      // Validate contextId matches if both provided
      if (messageContextId && existingTask.contextId !== messageContextId) {
        return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'contextId does not match task');
      }
    }

    const taskId = messageTaskId || randomUUID();
    const contextId = messageContextId || existingTask?.contextId || randomUUID();

    // Create or update task
    const task: Task = existingTask || {
      id: taskId,
      contextId,
      status: {
        state: TASK_STATES.WORKING,
        timestamp: new Date().toISOString(),
      },
      history: [],
      artifacts: [],
    };

    // Update task state
    task.status = {
      state: TASK_STATES.WORKING,
      timestamp: new Date().toISOString(),
    };
    task.history = task.history || [];
    task.history.push(params.message);
    
    this.tasks.set(taskId, task);

    // Context for handler
    const context: MessageContext = {
      taskId,
      contextId,
      sendStatus: (status) => {
        task.status = { ...status, timestamp: new Date().toISOString() };
      },
      sendArtifact: (artifact) => {
        task.artifacts = task.artifacts || [];
        task.artifacts.push(artifact);
      },
    };

    // Call handler
    try {
      const result = await this.config.onMessage(params.message, context);

      if (result.type === 'message') {
        // Direct message response - complete task
        task.status = {
          state: TASK_STATES.COMPLETED,
          message: result.message,
          timestamp: new Date().toISOString(),
        };
        task.history.push(result.message);
        
        // Per proto: SendMessageResponse { oneof payload { Task task = 1; Message message = 2; } }
        const response: SendMessageResponse = { task };
        return this.jsonRpcSuccess(id, response);
      } else if (result.type === 'working') {
        // Keep task in WORKING state (async completion via sendStatus)
        // Task is already in WORKING state, just return it
        const response: SendMessageResponse = { task };
        return this.jsonRpcSuccess(id, response);
      } else {
        // Task response - use handler's task
        const response: SendMessageResponse = { task: result.task };
        return this.jsonRpcSuccess(id, response);
      }
    } catch (err) {
      task.status = {
        state: TASK_STATES.FAILED,
        message: { role: 'agent', parts: [{ type: 'text', text: String(err) }] },
        timestamp: new Date().toISOString(),
      };
      // Still return task wrapped in response
      const response: SendMessageResponse = { task };
      return this.jsonRpcSuccess(id, response);
    }
  }

  private handleTasksGet(id: string | number, params: GetTaskRequest): JsonRpcResponse {
    if (!params?.id) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Missing task id');
    }

    // Validate historyLength if provided (must be non-negative)
    if (params.historyLength !== undefined && params.historyLength < 0) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'historyLength must be non-negative');
    }

    const task = this.tasks.get(params.id);
    if (!task) {
      return this.jsonRpcError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found');
    }

    // Apply history length limit if specified
    let responseTask = task;
    if (params.historyLength !== undefined && params.historyLength >= 0) {
      responseTask = { ...task };
      if (params.historyLength === 0) {
        delete responseTask.history;
      } else if (responseTask.history) {
        responseTask.history = responseTask.history.slice(-params.historyLength);
      }
    }

    // GetTask returns Task directly (not wrapped)
    return this.jsonRpcSuccess(id, responseTask);
  }

  private handleTasksCancel(id: string | number, params: CancelTaskRequest): JsonRpcResponse {
    if (!params?.id) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Missing task id');
    }

    const task = this.tasks.get(params.id);
    if (!task) {
      return this.jsonRpcError(id, A2A_ERROR_CODES.TASK_NOT_FOUND, 'Task not found');
    }

    if (TERMINAL_STATES.has(task.status.state)) {
      return this.jsonRpcError(id, A2A_ERROR_CODES.TASK_NOT_CANCELABLE, 'Task already in terminal state');
    }

    task.status = {
      state: TASK_STATES.CANCELED,
      timestamp: new Date().toISOString(),
    };

    // CancelTask returns Task directly (not wrapped)
    return this.jsonRpcSuccess(id, task);
  }

  private handleTasksList(id: string | number, params: ListTasksRequest): JsonRpcResponse {
    params = params || {};

    // Validate and extract params
    const pageSize = typeof params.pageSize === 'number' ? params.pageSize : 50;
    const pageToken = typeof params.pageToken === 'string' ? params.pageToken : undefined;
    const contextId = typeof params.contextId === 'string' ? params.contextId : undefined;
    const status = typeof params.status === 'string' ? params.status as TaskState : undefined;
    const historyLength = typeof params.historyLength === 'number' ? params.historyLength : undefined;
    const statusTimestampAfter = typeof params.statusTimestampAfter === 'string' ? params.statusTimestampAfter : undefined;
    const includeArtifacts = params.includeArtifacts === true;

    // Validate pageSize range
    if (pageSize < 1 || pageSize > 100) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'pageSize must be between 1 and 100');
    }

    // Validate historyLength (must be non-negative if provided)
    if (historyLength !== undefined && historyLength < 0) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'historyLength must be non-negative');
    }

    // Validate status filter
    if (status !== undefined && !VALID_TASK_STATES.has(status)) {
      return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, `Invalid status: ${status}`);
    }

    // Validate statusTimestampAfter (must be valid ISO 8601)
    let timestampFilter: Date | undefined;
    if (statusTimestampAfter !== undefined) {
      // Basic format validation - must look like ISO 8601 date/datetime
      // Reject obvious invalid values like "-1", numbers, etc.
      const looksLikeDate = /^\d{4}-\d{2}-\d{2}/.test(statusTimestampAfter);
      if (!looksLikeDate) {
        return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Invalid statusTimestampAfter: must be ISO 8601 format');
      }
      // Parse the timestamp
      timestampFilter = new Date(statusTimestampAfter);
      if (isNaN(timestampFilter.getTime())) {
        return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Invalid statusTimestampAfter timestamp');
      }
    }

    // Get all tasks and filter
    let tasks = Array.from(this.tasks.values());

    // Filter by contextId
    if (contextId) {
      tasks = tasks.filter(t => t.contextId === contextId);
    }

    // Filter by status
    if (status) {
      tasks = tasks.filter(t => t.status.state === status);
    }

    // Filter by timestamp
    if (timestampFilter) {
      tasks = tasks.filter(t => {
        if (!t.status.timestamp) return false;
        const taskTime = new Date(t.status.timestamp);
        return taskTime >= timestampFilter!;
      });
    }

    // Sort by timestamp descending (most recent first)
    tasks.sort((a, b) => {
      const aTime = a.status.timestamp ? new Date(a.status.timestamp).getTime() : 0;
      const bTime = b.status.timestamp ? new Date(b.status.timestamp).getTime() : 0;
      return bTime - aTime;
    });

    const totalSize = tasks.length;

    // Handle pagination
    let startIndex = 0;
    if (pageToken) {
      const decoded = parseInt(pageToken, 10);
      if (isNaN(decoded) || decoded < 0) {
        return this.jsonRpcError(id, JSONRPC_ERROR_CODES.INVALID_PARAMS, 'Invalid pageToken');
      }
      startIndex = decoded;
    }

    // Slice for page
    const pageTasks = tasks.slice(startIndex, startIndex + pageSize);

    // Apply historyLength limit and artifacts exclusion
    const resultTasks = pageTasks.map(t => {
      // Create shallow copy to avoid mutating stored task
      const task: Task = {
        id: t.id,
        contextId: t.contextId,
        status: t.status,
        metadata: t.metadata,
      };
      
      // Apply history limit
      if (historyLength === 0) {
        // Omit history entirely
      } else if (historyLength !== undefined && t.history) {
        task.history = t.history.slice(-historyLength);
      } else if (t.history) {
        task.history = t.history;
      }
      
      // Include artifacts only if requested
      if (includeArtifacts && t.artifacts) {
        task.artifacts = t.artifacts;
      }
      // When includeArtifacts=false (default), artifacts field is omitted entirely
      
      return task;
    });

    // Calculate next page token
    const nextStartIndex = startIndex + pageSize;
    const nextPageToken = nextStartIndex < totalSize ? String(nextStartIndex) : '';

    // Per TCK: pageSize should be actual returned count, not requested
    const response: ListTasksResponse = {
      tasks: resultTasks,
      nextPageToken,
      pageSize: resultTasks.length,
      totalSize,
    };

    return this.jsonRpcSuccess(id, response);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private normalizeMethodName(method: string): string {
    // Map camelCase to slash format (A2A spec supports both)
    const methodMap: Record<string, string> = {
      'SendMessage': 'message/send',
      'sendMessage': 'message/send',
      'message.send': 'message/send',
      'GetTask': 'tasks/get',
      'getTask': 'tasks/get',
      'tasks.get': 'tasks/get',
      'CancelTask': 'tasks/cancel',
      'cancelTask': 'tasks/cancel',
      'tasks.cancel': 'tasks/cancel',
      'ListTasks': 'tasks/list',
      'listTasks': 'tasks/list',
      'tasks.list': 'tasks/list',
      'GetAgentCard': 'agent/card',
      'getAgentCard': 'agent/card',
      'agent.card': 'agent/card',
    };
    return methodMap[method] || method;
  }

  private validateJsonRpcRequestDetailed(req: unknown): {
    valid: boolean;
    id: string | number | null;
    code: number;
    message: string;
  } {
    if (!req || typeof req !== 'object') {
      return { valid: false, id: null, code: JSONRPC_ERROR_CODES.INVALID_REQUEST, message: 'Invalid Request' };
    }

    const r = req as Record<string, unknown>;
    
    // Extract id for error responses (may be invalid type)
    let id: string | number | null = null;
    if (typeof r.id === 'string' || typeof r.id === 'number') {
      id = r.id;
    } else if (r.id !== undefined && r.id !== null) {
      // Invalid id type (e.g., object)
      return { valid: false, id: null, code: JSONRPC_ERROR_CODES.INVALID_REQUEST, message: 'Invalid Request: id must be string or number' };
    }

    // Check jsonrpc version
    if (r.jsonrpc !== '2.0') {
      return { valid: false, id, code: JSONRPC_ERROR_CODES.INVALID_REQUEST, message: 'Invalid Request: jsonrpc must be "2.0"' };
    }

    // Check method exists and is string
    if (typeof r.method !== 'string') {
      return { valid: false, id, code: JSONRPC_ERROR_CODES.INVALID_REQUEST, message: 'Invalid Request: method must be a string' };
    }

    // Check params is object or array if present
    if (r.params !== undefined && r.params !== null) {
      if (typeof r.params !== 'object') {
        return { valid: false, id, code: JSONRPC_ERROR_CODES.INVALID_PARAMS, message: 'Invalid params: must be object or array' };
      }
    }

    return { valid: true, id, code: 0, message: '' };
  }

  private jsonRpcSuccess(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id: id ?? randomUUID(), result };
  }

  private jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
    const error: JsonRpcError = { code, message };
    if (data !== undefined) error.data = data;
    return { jsonrpc: '2.0', id: id ?? randomUUID(), error };
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }
}
