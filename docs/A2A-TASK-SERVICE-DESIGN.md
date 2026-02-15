# A2A Task Service Design for OpenClaw

## The Concurrency Question

### How OpenClaw Handles Sessions

OpenClaw sessions are **single-threaded**:
- One active agent run per session at a time
- Messages arriving while agent is busy are **queued**
- Queue is delivered after current run completes
- `isEmbeddedPiRunActive(sessionId)` tracks active runs

### The A2A Expectation

A2A allows concurrent tasks:
- Multiple tasks can exist in same context
- Tasks can be queried/canceled while in progress
- Streaming tasks can receive updates mid-flight

### The Conflict

If we map A2A tasks 1:1 to OpenClaw sessions:
- Only one task can be "working" at a time
- Additional tasks would queue (invisible to A2A client)
- This breaks A2A semantics

## Proposed Solution: Task Service (Outside Session)

Instead of storing tasks *inside* sessions, create a **separate Task Service** that:
1. Manages A2A task lifecycle independently
2. Dispatches work to sessions when ready
3. Coordinates between multiple tasks in same context

```
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    A2A Task Service                         │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │ │
│  │  │ Task 1  │ │ Task 2  │ │ Task 3  │ │ Task 4  │          │ │
│  │  │ working │ │ queued  │ │completed│ │ failed  │          │ │
│  │  └────┬────┘ └────┬────┘ └─────────┘ └─────────┘          │ │
│  │       │           │                                        │ │
│  │       └─────┬─────┘                                        │ │
│  │             │ (dispatch one at a time)                     │ │
│  │             ▼                                              │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │              Session Dispatcher                      │  │ │
│  │  │  - Routes to correct session by contextId           │  │ │
│  │  │  - Respects session busy state                      │  │ │
│  │  │  - Queues tasks when session busy                   │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   OpenClaw Sessions                         │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │ │
│  │  │ Session A   │ │ Session B   │ │ Session C   │          │ │
│  │  │ (ctx-123)   │ │ (ctx-456)   │ │ (ctx-789)   │          │ │
│  │  │ [busy]      │ │ [idle]      │ │ [idle]      │          │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Task Service Components

### 1. TaskStore

Persistent storage for A2A tasks, independent of sessions.

```typescript
interface A2ATaskStore {
  // CRUD
  create(task: Task): Promise<Task>;
  get(id: string): Promise<Task | null>;
  update(id: string, updates: Partial<Task>): Promise<Task | null>;
  delete(id: string): Promise<boolean>;
  
  // Queries
  list(params: ListTasksParams): Promise<ListTasksResult>;
  findByContext(contextId: string): Promise<Task[]>;
  
  // Persistence
  save(): Promise<void>;
  load(): Promise<void>;
}
```

**Storage Options:**
- SQLite file (recommended for durability)
- JSON file (simple, less concurrent-safe)
- In-memory with periodic snapshots

### 2. TaskDispatcher

Routes tasks to sessions, respecting concurrency limits.

```typescript
interface TaskDispatcher {
  // Submit task for execution
  dispatch(task: Task): Promise<void>;
  
  // Session completed a task
  onTaskComplete(taskId: string, result: TaskResult): Promise<void>;
  
  // Check if session can accept work
  canDispatch(contextId: string): boolean;
  
  // Get pending tasks for context
  getPendingTasks(contextId: string): Task[];
}
```

**Dispatch Logic:**
```typescript
async function dispatch(task: Task): Promise<void> {
  const sessionKey = contextToSession(task.contextId);
  
  if (isSessionBusy(sessionKey)) {
    // Mark task as queued, will dispatch when session frees
    await taskStore.update(task.id, { 
      status: { state: 'submitted' },
      metadata: { ...task.metadata, queuedAt: Date.now() }
    });
    pendingQueue.add(task.contextId, task.id);
  } else {
    // Dispatch immediately
    await taskStore.update(task.id, { status: { state: 'working' } });
    await sendToSession(sessionKey, task);
  }
}

// Called when session completes work
async function onSessionIdle(sessionKey: string): Promise<void> {
  const contextId = sessionToContext(sessionKey);
  const nextTaskId = pendingQueue.shift(contextId);
  
  if (nextTaskId) {
    const task = await taskStore.get(nextTaskId);
    if (task) {
      await dispatch(task);
    }
  }
}
```

### 3. TaskService (Public API)

Exposes A2A task operations.

```typescript
interface A2ATaskService {
  // A2A methods
  sendMessage(request: SendMessageRequest): Promise<Task | Message>;
  getTask(id: string, params?: GetTaskParams): Promise<Task>;
  listTasks(params: ListTasksParams): Promise<ListTasksResult>;
  cancelTask(id: string): Promise<Task>;
  
  // Streaming
  subscribeToTask(id: string): AsyncIterable<StreamEvent>;
  
  // Integration hooks
  onSessionMessage(sessionKey: string, message: Message): void;
  onSessionComplete(sessionKey: string): void;
}
```

## Storage Location

### Option A: Dedicated SQLite Database

```
~/.openclaw/data/a2a-tasks.db
```

**Pros:**
- True concurrency support
- Efficient queries (indexes)
- Survives restarts
- Can store large task history

**Cons:**
- New dependency (better-sqlite3)
- Separate from session JSONL

### Option B: JSON File (Append-only)

```
~/.openclaw/data/a2a-tasks.jsonl
```

**Pros:**
- Simple, no new deps
- Similar to session format
- Human-readable

**Cons:**
- No efficient queries
- Grows unbounded
- Needs periodic compaction

### Option C: Per-Context Files

```
~/.openclaw/agents/main/a2a/
├── ctx-123/
│   ├── tasks.jsonl
│   └── state.json
├── ctx-456/
│   └── ...
```

**Pros:**
- Organized by context
- Easy cleanup
- Can link to session

**Cons:**
- Many files
- Cross-context queries harder

### Recommendation: Option A (SQLite)

SQLite provides the best balance:
- Single file, durable
- Efficient queries for list/filter
- Works with concurrent access (WAL mode)
- Can be backed up easily

## Schema

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  context_id TEXT,
  status_state TEXT NOT NULL,
  status_message TEXT,
  status_timestamp TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  artifacts TEXT,  -- JSON array
  history TEXT,    -- JSON array
  metadata TEXT    -- JSON object
);

CREATE INDEX idx_tasks_context ON tasks(context_id);
CREATE INDEX idx_tasks_status ON tasks(status_state);
CREATE INDEX idx_tasks_updated ON tasks(updated_at DESC);

-- For OPT extension
CREATE TABLE objectives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES objectives(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  dependencies TEXT,  -- JSON array of plan IDs
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE plan_tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  objective_id TEXT NOT NULL REFERENCES objectives(id),
  name TEXT NOT NULL,
  description TEXT,
  task_index INTEGER NOT NULL,
  dependencies TEXT,  -- JSON array of task IDs
  a2a_task_id TEXT REFERENCES tasks(id),
  metadata TEXT
);
```

## Integration with OpenClaw

### Gateway Plugin

```typescript
// src/plugins/a2a/index.ts
export const a2aPlugin: GatewayPlugin = {
  name: 'a2a',
  
  async onGatewayStart(gateway) {
    // Initialize task service
    const taskStore = new SQLiteTaskStore('~/.openclaw/data/a2a-tasks.db');
    await taskStore.load();
    
    const taskService = new A2ATaskService({
      store: taskStore,
      gateway,
    });
    
    // Register HTTP routes
    gateway.registerHttpRoute('/a2a', taskService.handleRequest);
    
    // Hook into session completion
    gateway.on('sessionIdle', (sessionKey) => {
      taskService.onSessionComplete(sessionKey);
    });
  }
};
```

### Session Hooks

```typescript
// When session completes a message
gateway.on('messageComplete', ({ sessionKey, response }) => {
  const taskId = getActiveTaskForSession(sessionKey);
  if (taskId) {
    taskService.completeTask(taskId, response);
  }
});

// When session errors
gateway.on('messageError', ({ sessionKey, error }) => {
  const taskId = getActiveTaskForSession(sessionKey);
  if (taskId) {
    taskService.failTask(taskId, error);
  }
});
```

## Concurrent Task Behavior

### Same Context, Multiple Tasks

```
Client sends: Task A (ctx-123)
Client sends: Task B (ctx-123)  -- while A is processing
Client sends: Task C (ctx-123)  -- while A is processing

Task A → dispatched to session, state: "working"
Task B → queued, state: "submitted" (or new state: "queued")
Task C → queued, state: "submitted"

When A completes:
  Task A → state: "completed"
  Task B → dispatched, state: "working"

When B completes:
  Task B → state: "completed"
  Task C → dispatched, state: "working"
```

### Different Contexts, Concurrent

```
Client sends: Task A (ctx-123)
Client sends: Task B (ctx-456)

Task A → dispatched to session-123, state: "working"
Task B → dispatched to session-456, state: "working"
(both run concurrently in different sessions)
```

## Design Decisions (Confirmed)

1. **Task TTL**: 7 days for completed/failed, configurable via `a2a.tasks.ttlDays`

2. **Queue limits**: 9999 queued tasks per context. Reject with error after.

3. **Task timeout**: 30min default, configurable via `a2a.tasks.timeoutMinutes`

4. **Streaming**: Basic streaming (final response only) for v1. Full streaming on roadmap.

5. **Push notifications**: Deferred. Polling + streaming covers v1 use cases.

6. **Concurrent tasks**: Queue (not reject). Process sequentially per context.

7. **History scope**: Configurable — task, plan, or objective scoped (not full session).
   - Default: task-scoped
   - With OPT: can request plan or objective scope via metadata

## Implementation Plan

### Phase 1: Core Task Service
- [ ] SQLite task store
- [ ] TaskService with CRUD
- [ ] Basic dispatch (no queuing)

### Phase 2: Concurrency
- [ ] Task queuing per context
- [ ] Session idle hooks
- [ ] Queue dispatch logic

### Phase 3: Gateway Integration
- [ ] HTTP route registration
- [ ] Session completion hooks
- [ ] Error handling

### Phase 4: OPT Extension
- [ ] Objective/Plan tables
- [ ] OPT methods integration
- [ ] Session-to-OPT linking

### Phase 5: Streaming & Polish
- [ ] SSE streaming
- [ ] Task cleanup/TTL
- [ ] Metrics/logging
