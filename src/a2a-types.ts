/**
 * A2A Protocol Types (v1.0 RC)
 * Based on: https://a2a-protocol.org/latest/specification/
 * Proto source: https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto
 */

// ============================================================================
// Core Types (per proto enum definitions)
// ============================================================================

export type Role = 'ROLE_USER' | 'ROLE_AGENT' | 'user' | 'agent';

export interface Part {
  type?: string;
  text?: string;
  file?: FilePart;
  data?: DataPart;
}

export interface TextPart extends Part {
  type: 'text';
  text: string;
}

export interface FilePart {
  name?: string;
  mimeType?: string;
  bytes?: string; // base64
  fileWithUri?: string;  // v1.0 name
  uri?: string;          // v0.3 compat
}

export interface DataPart {
  mimeType: string;
  data: unknown;
}

export interface Message {
  messageId?: string;
  contextId?: string;   // Optional: associate with context
  taskId?: string;      // Optional: associate with/continue task
  role: Role;
  parts: Part[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];  // Reference other tasks for context
}

// ============================================================================
// Task Types (per proto TaskState enum)
// ============================================================================

// Proto enum: TASK_STATE_SUBMITTED, TASK_STATE_WORKING, etc.
export type TaskState = 
  | 'TASK_STATE_SUBMITTED'
  | 'TASK_STATE_WORKING'
  | 'TASK_STATE_INPUT_REQUIRED'
  | 'TASK_STATE_COMPLETED'
  | 'TASK_STATE_FAILED'
  | 'TASK_STATE_CANCELED'
  | 'TASK_STATE_REJECTED'
  // Backwards compat with v0.3 lowercase
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected';

// Canonical state values (v1.0)
export const TASK_STATES = {
  SUBMITTED: 'TASK_STATE_SUBMITTED',
  WORKING: 'TASK_STATE_WORKING',
  INPUT_REQUIRED: 'TASK_STATE_INPUT_REQUIRED',
  COMPLETED: 'TASK_STATE_COMPLETED',
  FAILED: 'TASK_STATE_FAILED',
  CANCELED: 'TASK_STATE_CANCELED',
  REJECTED: 'TASK_STATE_REJECTED',
} as const;

// Valid state values for validation
export const VALID_TASK_STATES = new Set([
  'TASK_STATE_SUBMITTED', 'TASK_STATE_WORKING', 'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED',
  // Also accept lowercase for backwards compat
  'submitted', 'working', 'input-required', 'completed', 'failed', 'canceled', 'rejected',
]);

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;
}

export interface Artifact {
  name?: string;
  description?: string;
  parts: Part[];
  index?: number;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Task {
  id: string;
  contextId?: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Agent Card Types
// ============================================================================

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
  extendedAgentCard?: boolean;
}

export interface AgentProvider {
  organization: string;
  url?: string;
}

export type SecurityScheme = 
  | { type: 'apiKey'; in: 'header' | 'query'; name: string }
  | { type: 'http'; scheme: 'bearer' | 'basic' }
  | { type: 'oauth2'; flows: Record<string, unknown> }
  | { type: 'openIdConnect'; openIdConnectUrl: string };

export interface AgentAuthentication {
  schemes: string[];
  credentials?: string;
}

export interface AgentCard {
  name: string;
  description?: string;
  url: string;
  provider?: AgentProvider;
  version?: string;
  documentationUrl?: string;
  capabilities: AgentCapabilities;
  supportedInterfaces?: Array<string | { protocolBinding: string; url?: string }>;
  supportedModalities?: string[];  // e.g., ['text', 'image', 'audio']
  authentication?: AgentAuthentication;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  skills?: AgentSkill[];
  securitySchemes?: Record<string, SecurityScheme>;
}

// ============================================================================
// JSON-RPC Types
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// A2A-specific error codes
export const A2A_ERROR_CODES = {
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_RESPONSE: -32006,
  EXTENDED_AGENT_CARD_NOT_CONFIGURED: -32007,
  EXTENSION_SUPPORT_REQUIRED: -32008,
  VERSION_NOT_SUPPORTED: -32009,
} as const;

// Standard JSON-RPC error codes
export const JSONRPC_ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

// ============================================================================
// Request/Response Types (per proto message definitions)
// ============================================================================

export interface SendMessageRequest {
  message: Message;
  configuration?: SendMessageConfiguration;
  metadata?: Record<string, unknown>;
}

export interface SendMessageConfiguration {
  acceptedOutputModes?: string[];
  blocking?: boolean;
  historyLength?: number;
  pushNotificationConfig?: PushNotificationConfig;
}

/**
 * SendMessageResponse wraps Task or Message per proto:
 * message SendMessageResponse {
 *   oneof payload {
 *     Task task = 1;
 *     Message message = 2;
 *   }
 * }
 */
export interface SendMessageResponse {
  task?: Task;
  message?: Message;
}

export interface PushNotificationConfig {
  url: string;
  token?: string;
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
}

export interface GetTaskRequest {
  id: string;
  historyLength?: number;
}

export interface CancelTaskRequest {
  id: string;
}

export interface ListTasksRequest {
  contextId?: string;
  status?: TaskState;
  pageSize?: number;
  pageToken?: string;
  historyLength?: number;
  statusTimestampAfter?: string;  // ISO 8601
  includeArtifacts?: boolean;
}

/**
 * ListTasksResponse per proto
 */
export interface ListTasksResponse {
  tasks: Task[];
  nextPageToken: string;  // Required, empty string if no more
  pageSize: number;       // Required
  totalSize: number;      // Required
}

// ============================================================================
// Streaming Types
// ============================================================================

export interface TaskStatusUpdateEvent {
  type: 'status';
  taskId: string;
  status: TaskStatus;
  final?: boolean;
}

export interface TaskArtifactUpdateEvent {
  type: 'artifact';
  taskId: string;
  artifact: Artifact;
}

export type StreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

/**
 * StreamResponse wraps different event types per proto:
 * message StreamResponse {
 *   oneof payload {
 *     Task task = 1;
 *     Message message = 2;
 *     TaskStatusUpdateEvent status_update = 3;
 *     TaskArtifactUpdateEvent artifact_update = 4;
 *   }
 * }
 */
export interface StreamResponse {
  task?: Task;
  message?: Message;
  statusUpdate?: TaskStatusUpdateEvent;
  artifactUpdate?: TaskArtifactUpdateEvent;
}
