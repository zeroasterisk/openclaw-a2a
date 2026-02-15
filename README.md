# OpenClaw A2A

**Add A2A (Agent2Agent) protocol support to OpenClaw.** Let other AI agents discover and talk to your OpenClaw agent — or call remote A2A agents from your workflows.

🎯 **TCK Status:** 100% compliant (120/120 tests passing)

---

## TL;DR

This plugin makes your OpenClaw agent accessible via the [A2A protocol](https://a2a-protocol.org/). Think of it as adding a universal API that any A2A-compatible agent can use to:

- Send messages to your agent
- Track task progress  
- Get structured responses

Works behind NAT (via relay) or with public URLs (direct mode).

```bash
npm install openclaw-a2a
```

```jsonc
// openclaw.json
{
  "a2a": {
    "enabled": true,
    "server": {
      "mode": "relay",
      "relay": {
        "url": "wss://your-relay.example.com/agent",
        "agentId": "my-agent"
      }
    }
  }
}
```

---

## Getting Started

### 1. Install

```bash
cd your-openclaw-project
npm install openclaw-a2a
```

### 2. Choose Your Mode

**Relay Mode** (recommended for home/laptop):
- No public URL needed
- Works behind NAT/firewall
- Connects outbound to a relay server

**Direct Mode** (for cloud deployments):
- Exposes HTTP endpoints directly
- Requires public URL + TLS
- Lower latency

### 3. Configure

**Relay Mode:**
```jsonc
{
  "a2a": {
    "enabled": true,
    "server": {
      "mode": "relay",
      "relay": {
        "url": "wss://a2a-relay.example.com/agent",
        "tenant": "personal",
        "agentId": "zaf",
        "token": "${A2A_RELAY_TOKEN}"
      }
    }
  }
}
```

**Direct Mode:**
```jsonc
{
  "a2a": {
    "enabled": true,
    "server": {
      "mode": "direct",
      "direct": {
        "path": "/a2a",
        "publicUrl": "https://my-agent.example.com"
      }
    }
  }
}
```

### 4. Test It

Your agent will automatically generate an Agent Card:

```bash
# Direct mode
curl https://my-agent.example.com/.well-known/agent.json

# Or test locally
curl http://localhost:9999/.well-known/agent.json
```

Send a message:
```bash
curl -X POST http://localhost:9999 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "messageId": "test-1",
        "role": "user",
        "parts": [{"type": "text", "text": "Hello!"}]
      }
    }
  }'
```

---

## Detailed Documentation

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      OpenClaw Gateway                            │
│                                                                  │
│  Telegram │ Discord │ Signal │ A2A  ← channels                  │
│                      ↓                                           │
│              Session Router → Agent Sessions                     │
│                                                                  │
│  A2A specific:                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ A2A Server (direct) │ A2A Relay Client (relay mode)      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

A2A is treated as another **channel** — just like Telegram or Discord. Messages come in via A2A, get routed to agent sessions, and responses go back via A2A.

### A2A Methods Supported

| Method | Description | Status |
|--------|-------------|--------|
| `message/send` | Send a message, get task back | ✅ |
| `tasks/get` | Get task by ID | ✅ |
| `tasks/list` | List tasks with filters | ✅ |
| `tasks/cancel` | Cancel a running task | ✅ |
| `message/stream` | Stream responses (SSE) | 🚧 Planned |

### Session Mapping

A2A `contextId` → OpenClaw session:
```
agent:main:a2a:{contextId}
```

Multiple tasks can share a context (conversation continuity). Tasks within the same context are processed sequentially.

### Agent Card Generation

The plugin auto-generates an Agent Card from your OpenClaw config:

```json
{
  "name": "My Agent",
  "description": "From openclaw config",
  "url": "https://...",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": true
  },
  "skills": [
    // Auto-populated from OpenClaw skills
  ]
}
```

Override any field via `a2a.agentCard` in config.

### Task Lifecycle

```
submitted → working → completed
                   ↘ failed
                   ↘ canceled
```

- **submitted**: Task received, may be queued
- **working**: Agent is processing
- **completed**: Response ready
- **failed**: Error occurred
- **canceled**: User/client canceled

### Persistence

Tasks persist in SQLite (`~/.openclaw/data/a2a-tasks.db`). Survives gateway restarts.

- Active tasks: kept indefinitely
- Completed/failed: 7 days (configurable)

### Configuration Reference

```typescript
interface A2AConfig {
  enabled?: boolean;              // Enable A2A plugin
  
  server?: {
    enabled?: boolean;            // Enable server mode
    mode?: 'direct' | 'relay';    // Connection mode
    
    direct?: {
      path?: string;              // Default: /a2a
      publicUrl?: string;         // Required for discovery
    };
    
    relay?: {
      url: string;                // Relay WebSocket URL
      tenant?: string;            // Multi-tenant namespace
      agentId: string;            // Your agent ID
      token?: string;             // Auth token
    };
    
    auth?: {
      scheme?: 'bearer' | 'apiKey';
      apiKey?: string;
    };
  };
  
  client?: {
    enabled?: boolean;
    agents?: Record<string, {     // Named remote agents
      url: string;
      token?: string;
    }>;
  };
  
  tasks?: {
    ttlDays?: number;             // Default: 7
    timeoutMinutes?: number;      // Default: 30
    maxQueuedPerContext?: number; // Default: 100
  };
  
  agentCard?: Partial<AgentCard>; // Override auto-generated fields
}
```

### Calling Remote A2A Agents

Enable client mode to call other A2A agents:

```jsonc
{
  "a2a": {
    "client": {
      "enabled": true,
      "agents": {
        "research-bot": {
          "url": "https://research-bot.example.com/a2a"
        }
      }
    }
  }
}
```

Your agent gets tools:
- `a2a_list_agents` — List configured agents
- `a2a_send_message` — Send message to agent
- `a2a_get_task` — Check task status

### Development

```bash
# Clone
git clone https://github.com/zeroasterisk/openclaw-a2a
cd openclaw-a2a

# Install
npm install

# Build
npm run build

# Run tests
npm test

# Run test server (for TCK)
node dist/test-server.js

# Run TCK tests (requires a2a-tck repo)
cd ../a2a-tck
python run_tck.py --sut-url http://localhost:9999 --category all
```

### E2E Testing with Relay

Test the full relay flow (Client → Relay → Agent → Response):

```bash
# Against deployed relay
RELAY_SECRET=your-secret ./e2e-test.sh https://your-relay.example.com

# Against local relay
RELAY_SECRET=test-secret ./e2e-test.sh http://localhost:8765
```

The E2E test:
1. Starts a test agent
2. Connects it to the relay
3. Sends a message
4. Verifies the response

---

## OPT Extension (Objective-Plan-Task)

For hierarchical task management (Objectives → Plans → Tasks), see the standalone extension:

📦 **[a2a-opt](https://github.com/zeroasterisk/a2a-opt)** — works with any A2A implementation

This package will include an OPT adapter for OpenClaw sessions.

## Design Documents

For implementation details and architecture decisions:

- [OpenClaw Integration Design](docs/OPENCLAW-INTEGRATION.md)
- [A2A Task Service Design](docs/A2A-TASK-SERVICE-DESIGN.md)

---

## License

Apache-2.0
