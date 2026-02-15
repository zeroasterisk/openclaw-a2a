# OpenClaw A2A Integration Design

## Overview

A2A becomes another **channel** in OpenClaw — just like Telegram, Discord, or Signal. Other agents can discover and interact with your OpenClaw agent via the A2A protocol.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      OpenClaw Gateway                            │
│                                                                  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │  Telegram  │ │  Discord   │ │   Signal   │ │    A2A     │   │
│  │  Channel   │ │  Channel   │ │  Channel   │ │  Channel   │   │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘ └─────┬──────┘   │
│        │              │              │              │           │
│        └──────────────┴──────────────┴──────────────┘           │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │   Session Router   │                        │
│                    │   (MsgContext)     │                        │
│                    └─────────┬─────────┘                        │
│                              │                                   │
│                    ┌─────────▼─────────┐                        │
│                    │   Agent Session    │                        │
│                    │   (LLM + Tools)    │                        │
│                    └───────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

## Session Key Mapping

### Question: How do A2A Tasks map to OpenClaw Sessions?

**Option A: Task = Session**
- Each A2A Task creates a new session key: `agent:main:a2a:{taskId}`
- Simple, clean isolation
- No conversation continuity across tasks

**Option B: Context = Session**
- A2A `contextId` maps to session: `agent:main:a2a:{contextId}`
- Multiple tasks can share a session (conversation continuity)
- Matches A2A's intent for `contextId`

**Option C: Client = Session**
- Session based on calling agent/client identity
- `agent:main:a2a:{clientAgentUrl}` or `agent:main:a2a:{clientId}`
- Persistent relationship with each caller

**Recommendation: Option B (Context = Session)**

Rationale:
- A2A's `contextId` is designed for grouping related interactions
- If client sends same `contextId`, they continue the conversation
- If no `contextId`, we generate one (single-turn interaction)
- Maps cleanly to OpenClaw's session model

```typescript
function a2aToSessionKey(params: {
  agentId: string;
  contextId?: string;
  taskId: string;
}): string {
  const ctx = params.contextId || params.taskId; // fallback to task if no context
  return `agent:${params.agentId}:a2a:${ctx}`;
}
```

## MsgContext Mapping

A2A Message → OpenClaw MsgContext:

```typescript
function a2aMessageToContext(
  message: A2AMessage,
  task: Task,
  config: A2AChannelConfig
): MsgContext {
  return {
    Body: extractText(message.parts),
    BodyForAgent: extractText(message.parts),
    From: task.metadata?.clientId || 'a2a-client',
    To: config.agentId,
    SessionKey: a2aToSessionKey({
      agentId: config.agentId,
      contextId: task.contextId,
      taskId: task.id,
    }),
    MessageSid: task.id,
    OriginatingChannel: 'a2a',
    AccountId: config.accountId || 'default',
    ChatType: 'direct', // A2A is always direct (no groups yet)
    // A2A-specific metadata
    A2ATaskId: task.id,
    A2AContextId: task.contextId,
  };
}
```

## Connectivity Modes

### Direct Mode
- OpenClaw exposes HTTP endpoints at configured path
- Requires public URL + TLS
- Lowest latency

```yaml
# openclaw.json
a2a:
  server:
    enabled: true
    mode: direct
    path: /a2a
    publicUrl: https://my-agent.example.com
```

### Relay Mode  
- OpenClaw connects outbound to relay via WebSocket
- Works behind NAT/firewall
- No public URL needed

```yaml
a2a:
  server:
    enabled: true
    mode: relay
    relay:
      url: wss://a2a-relay-prod-442090395636.us-central1.run.app/agent
      tenant: personal
      agentId: zaf
      token: ${A2A_RELAY_TOKEN}
```

### Both
- Direct for low-latency public access
- Relay as fallback / alternative path

## Agent Card Generation

Auto-generate from OpenClaw config + skills:

```typescript
function buildAgentCard(gateway: Gateway): AgentCard {
  const cfg = gateway.config;
  
  // Gather skills from available skills
  const skills = gateway.skills.map(skill => ({
    id: skill.name,
    name: skill.displayName || skill.name,
    description: skill.description,
  }));
  
  // Add tool-based skills
  const toolSkills = gateway.tools
    .filter(t => t.expose !== false)
    .map(tool => ({
      id: tool.name,
      name: tool.displayName || tool.name,
      description: tool.description,
    }));
  
  return {
    name: cfg.agent?.name || cfg.a2a?.agentCard?.name || 'OpenClaw Agent',
    description: cfg.agent?.description || cfg.a2a?.agentCard?.description,
    url: resolveAgentUrl(cfg),
    version: '1.0.0',
    capabilities: {
      streaming: cfg.a2a?.streaming ?? true,
      pushNotifications: false, // Not supported initially
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [...skills, ...toolSkills],
    // Auth from config
    authentication: cfg.a2a?.auth ? {
      schemes: [cfg.a2a.auth.scheme],
    } : undefined,
  };
}
```

## Response Mapping

OpenClaw reply → A2A response:

```typescript
function replyToA2ATask(
  reply: ReplyPayload,
  task: Task
): Task {
  // Convert reply to A2A message
  const responseMessage: Message = {
    role: 'agent',
    parts: replyToParts(reply),
  };
  
  return {
    ...task,
    status: {
      state: 'completed',
      message: responseMessage,
      timestamp: new Date().toISOString(),
    },
    history: [...(task.history || []), responseMessage],
  };
}

function replyToParts(reply: ReplyPayload): Part[] {
  const parts: Part[] = [];
  
  if (reply.text) {
    parts.push({ type: 'text', text: reply.text });
  }
  
  if (reply.media) {
    parts.push({
      type: 'file',
      file: {
        uri: reply.media.url,
        mimeType: reply.media.mimeType,
        name: reply.media.filename,
      },
    });
  }
  
  return parts;
}
```

## Streaming

For streaming mode (`message/stream`):

1. Client sends message
2. Server returns SSE stream
3. As agent generates response, emit `TaskStatusUpdateEvent`
4. For tool outputs, emit `TaskArtifactUpdateEvent`
5. Final event has `final: true`

```typescript
async function* handleStreamingMessage(
  request: SendMessageRequest,
  gateway: Gateway
): AsyncGenerator<StreamEvent> {
  const task = createTask(request);
  yield { type: 'task', task };
  
  // Set up streaming from agent
  const session = await getOrCreateSession(task, gateway);
  
  for await (const chunk of session.streamReply(request.message)) {
    if (chunk.type === 'text') {
      yield {
        type: 'status',
        taskId: task.id,
        status: {
          state: 'working',
          message: { role: 'agent', parts: [{ type: 'text', text: chunk.text }] },
        },
      };
    } else if (chunk.type === 'tool_result') {
      yield {
        type: 'artifact',
        taskId: task.id,
        artifact: {
          name: chunk.toolName,
          parts: [{ type: 'text', text: JSON.stringify(chunk.result) }],
        },
      };
    }
  }
  
  yield {
    type: 'status',
    taskId: task.id,
    status: { state: 'completed' },
    final: true,
  };
}
```

## Plugin Structure

```
openclaw-a2a/
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── a2a-types.ts          # A2A protocol types
│   ├── a2a-server.ts         # HTTP server (direct mode)
│   ├── a2a-relay-client.ts   # WebSocket client (relay mode)
│   ├── channel/
│   │   ├── plugin.ts         # ChannelPlugin implementation
│   │   ├── inbound.ts        # A2A → MsgContext
│   │   ├── outbound.ts       # Reply → A2A response
│   │   └── agent-card.ts     # AgentCard generation
│   └── tools/
│       └── a2a-client.ts     # Tools for calling remote A2A agents
├── package.json
└── tsconfig.json
```

## Configuration Schema

```typescript
interface A2AConfig {
  enabled?: boolean;
  
  server?: {
    enabled?: boolean;
    mode?: 'direct' | 'relay' | 'both';
    
    // Direct mode
    path?: string;           // Default: /a2a
    publicUrl?: string;      // Required for direct
    
    // Relay mode
    relay?: {
      url: string;           // Relay WebSocket URL
      tenant: string;
      agentId: string;
      token: string;
    };
    
    // Auth
    auth?: {
      scheme: 'bearer' | 'apiKey';
      apiKey?: string;       // For apiKey scheme
      validateToken?: (token: string) => boolean;
    };
  };
  
  client?: {
    enabled?: boolean;
    agents?: Record<string, {
      url: string;
      token?: string;
    }>;
  };
  
  agentCard?: Partial<AgentCard>;  // Overrides for auto-generated card
}
```

## Design Decisions (Confirmed)

1. **Task Persistence**: Yes — SQLite database (`~/.openclaw/data/a2a-tasks.db`)
   - Survives gateway restarts
   - 7-day TTL for completed/failed tasks

2. **Concurrent Tasks**: Queue (max 9999 per context)
   - Accept all, process sequentially
   - Queued tasks return "submitted" state
   - Visible via `tasks/list`

3. **History Scope**: Task, plan, or objective scoped (not full session)
   - Default: task-scoped (messages from this task only)
   - With OPT extension: can scope to plan or objective
   - Controlled via `historyLength` + metadata

4. **Auth Model (v1)**: Relay-trust + API key
   - Relay mode: Trust relay's JWT auth
   - Direct mode: Simple API key in config
   - OAuth2 and mTLS on roadmap (high priority)

## Implementation Plan

### Phase 1: Basic Server (TCK Compliance)
- [ ] Full JSON-RPC compliance
- [ ] All mandatory methods
- [ ] Pass TCK mandatory tests

### Phase 2: OpenClaw Integration
- [ ] Channel plugin structure
- [ ] MsgContext mapping
- [ ] Direct mode HTTP endpoints
- [ ] Agent card from config/skills

### Phase 3: Relay Mode
- [ ] WebSocket client for relay connection
- [ ] Auto-reconnect
- [ ] Both mode support

### Phase 4: Client Tools
- [ ] `a2a_send` tool for calling remote agents
- [ ] Agent discovery
- [ ] Multi-agent orchestration

### Phase 5: Streaming
- [ ] SSE streaming for message/stream
- [ ] Real-time status updates
- [ ] Artifact streaming
