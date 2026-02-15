# A2A Objective-Plan-Task Extension

## Overview

This extension adds hierarchical task management to A2A, enabling agents to:
- Group related tasks under **Objectives** (high-level goals)
- Organize work into **Plans** (structured approaches)
- Track individual **Tasks** with full A2A compatibility

This maps naturally to how humans and AI agents think about complex work:
**Objective** → **Plan** → **Task**

## Extension URI

```
https://github.com/zeroasterisk/a2a-opt/v1
```

Or potentially for broader adoption:
```
https://a2a-protocol.org/extensions/objective-plan-task/v1
```

## Motivation

A2A's core Task model is great for individual request-response interactions, but complex agent orchestration often needs:

1. **Hierarchical organization** — Tasks grouped into larger goals
2. **Persistence** — State that survives session restarts
3. **Planning** — Structured decomposition of objectives into steps
4. **Progress tracking** — High-level visibility into multi-step work
5. **Context sharing** — Related tasks share context without repetition

## Data Model

### Objective

The top-level goal or desired outcome.

```typescript
interface Objective {
  id: string;                    // Unique identifier
  name: string;                  // Human-readable name
  description?: string;          // Detailed description
  status: ObjectiveStatus;       // submitted | working | completed | failed | canceled
  plans?: Plan[];                // Ordered plans to achieve this objective
  metadata?: Record<string, unknown>;
  createdAt: string;             // ISO 8601 timestamp
  updatedAt: string;             // ISO 8601 timestamp
}

type ObjectiveStatus = 
  | 'submitted'    // Just created
  | 'planning'     // Agent is creating/refining plans
  | 'working'      // Plans are being executed
  | 'blocked'      // Waiting on external input
  | 'completed'    // All plans completed successfully
  | 'failed'       // Objective cannot be achieved
  | 'canceled';    // User canceled
```

### Plan

A structured approach to achieving an objective, containing ordered tasks.

```typescript
interface Plan {
  id: string;
  objectiveId: string;           // Parent objective
  name: string;
  description?: string;
  status: PlanStatus;
  tasks?: Task[];                // Ordered tasks in this plan
  dependencies?: string[];       // IDs of plans that must complete first
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

type PlanStatus =
  | 'pending'      // Not yet started
  | 'working'      // Tasks are being executed
  | 'blocked'      // Waiting on dependencies or input
  | 'completed'    // All tasks completed
  | 'failed'       // Plan cannot be completed
  | 'skipped';     // Plan was skipped (alternative chosen)
```

### Task (Extended A2A Task)

The core A2A Task, extended with plan/objective context.

```typescript
interface ExtendedTask extends Task {
  // Standard A2A Task fields
  id: string;
  contextId?: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
  
  // OPT Extension fields (in metadata)
  // metadata["opt/v1/planId"]?: string;
  // metadata["opt/v1/objectiveId"]?: string;
  // metadata["opt/v1/taskIndex"]?: number;
  // metadata["opt/v1/dependencies"]?: string[];
}
```

## Metadata Keys

The extension uses the following metadata keys:

| Key | Location | Type | Description |
|-----|----------|------|-------------|
| `opt/v1/objectiveId` | Task | string | ID of parent objective |
| `opt/v1/planId` | Task | string | ID of parent plan |
| `opt/v1/taskIndex` | Task | number | Order within plan (0-indexed) |
| `opt/v1/dependencies` | Task | string[] | IDs of tasks that must complete first |
| `opt/v1/objective` | Message | Objective | Full objective in request |
| `opt/v1/plan` | Message | Plan | Full plan in request |

## Extension Activation

Clients activate the extension via the `A2A-Extensions` header:

```http
POST /agents/planner HTTP/1.1
A2A-Extensions: https://github.com/zeroasterisk/a2a-opt/v1
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "method": "message/send",
  "id": "1",
  "params": {
    "message": {
      "role": "user",
      "parts": [{"text": "Plan a birthday party for 20 people"}],
      "metadata": {
        "opt/v1/objective": {
          "id": "obj-123",
          "name": "Plan birthday party",
          "status": "submitted"
        }
      }
    }
  }
}
```

## New RPC Methods (Extended Skills)

The extension adds optional RPC methods for direct objective/plan management:

### objectives/create

Create a new objective.

```json
{
  "jsonrpc": "2.0",
  "method": "objectives/create",
  "id": "1",
  "params": {
    "name": "Plan birthday party",
    "description": "Organize a party for 20 guests"
  }
}
```

### objectives/get

Retrieve an objective with its plans and tasks.

```json
{
  "jsonrpc": "2.0",
  "method": "objectives/get",
  "id": "2",
  "params": {
    "id": "obj-123",
    "includePlans": true,
    "includeTasks": true
  }
}
```

### objectives/list

List objectives with filtering.

```json
{
  "jsonrpc": "2.0",
  "method": "objectives/list",
  "id": "3",
  "params": {
    "status": "working",
    "pageSize": 10
  }
}
```

### plans/create

Create a plan for an objective.

```json
{
  "jsonrpc": "2.0",
  "method": "plans/create",
  "id": "4",
  "params": {
    "objectiveId": "obj-123",
    "name": "Venue and catering",
    "tasks": [
      {"name": "Research venues", "description": "Find 3 options"},
      {"name": "Get catering quotes", "description": "Budget: $500"}
    ]
  }
}
```

### plans/update

Update plan status or tasks.

```json
{
  "jsonrpc": "2.0",
  "method": "plans/update",
  "id": "5",
  "params": {
    "id": "plan-456",
    "status": "completed"
  }
}
```

## Agent Card Declaration

Agents declare support in their Agent Card:

```json
{
  "name": "Planning Agent",
  "capabilities": {
    "extensions": [
      {
        "uri": "https://github.com/zeroasterisk/a2a-opt/v1",
        "required": false,
        "params": {
          "maxPlansPerObjective": 10,
          "maxTasksPerPlan": 50,
          "persistenceEnabled": true
        }
      }
    ]
  }
}
```

## OpenClaw Session Integration

### Session Key Mapping

```
Objective → OpenClaw Session (contextId)
Plan      → Session subsection / metadata
Task      → A2A Task (stored in session)
```

Session key format:
```
agent:main:a2a:obj:{objectiveId}
```

### Storage Model

```typescript
// Stored in OpenClaw session JSONL
interface OPTSessionState {
  objective: Objective;
  plans: Plan[];
  tasks: Map<string, Task>;  // taskId → Task
}

// Session file structure
// ~/.openclaw/agents/main/sessions/a2a_obj_123.jsonl
// Each line is a JSON object representing state changes
```

### Persistence Strategy

1. **On task create**: Append task to session JSONL
2. **On task update**: Append status update to JSONL
3. **On session load**: Reconstruct state from JSONL
4. **On objective complete**: Mark session as archived

## Use Cases

### 1. Multi-Agent Orchestration

```
User: "Research and write a blog post about AI safety"

Objective: Write AI safety blog post
├── Plan 1: Research
│   ├── Task 1: Search for recent papers
│   ├── Task 2: Summarize key findings
│   └── Task 3: Identify expert quotes
├── Plan 2: Writing
│   ├── Task 4: Create outline
│   ├── Task 5: Write draft
│   └── Task 6: Add citations
└── Plan 3: Review
    ├── Task 7: Self-review
    └── Task 8: Request feedback
```

### 2. Long-Running Projects

```
Objective: Migrate database to new schema
├── Plan: Analysis (completed)
├── Plan: Implementation (working)
│   ├── Task: Create migration script ✓
│   ├── Task: Test on staging ← current
│   └── Task: Deploy to production
└── Plan: Validation (pending)
```

### 3. Human-in-the-Loop

```
Objective: Book travel for conference
├── Plan: Flights
│   ├── Task: Search options ✓
│   └── Task: Get approval ← input-required
├── Plan: Hotel (blocked - waiting on flight dates)
└── Plan: Ground transport (pending)
```

## Implementation Considerations

### For Extension Implementers

1. **Backwards compatibility**: Tasks work normally even without extension
2. **Graceful degradation**: If agent doesn't support OPT, fall back to flat tasks
3. **State recovery**: Must handle partial state on crash/restart
4. **Concurrency**: Plans can execute tasks in parallel if no dependencies

### For OpenClaw Integration

1. **Channel mapping**: A2A OPT → OpenClaw session with OPT metadata
2. **Persistence**: Use existing session JSONL format
3. **UI**: Could expose objectives/plans in status/dashboard
4. **Tools**: Agent tools can create/update objectives programmatically

## Version History

- **v1** (2026-02): Initial specification

## References

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Extensions Guide](https://a2a-protocol.org/latest/topics/extensions/)
- [OpenClaw Session Management](https://docs.openclaw.ai/sessions)
