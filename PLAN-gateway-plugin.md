# Plan: Gateway Plugin Integration for A2A

**Task:** Replace the OpenClaw simulator (`openclaw-agent-sim.ts`) with a real Gateway plugin that routes A2A requests to OpenClaw sessions.

**Status:** Planning
**Created:** 2026-02-15 16:40 UTC
**Subagent:** a2a-task-test

---

## Context

Currently we have:
1. `openclaw-agent-sim.ts` - Standalone simulator that fakes OpenClaw responses
2. `openclaw-bridge.ts` - HTTP bridge concept (calls hypothetical `/api/sessions/send`)
3. Working relay connection via `RelayClient`

The goal: Make a **real Gateway plugin** that:
- Connects to the A2A relay as an agent
- Routes incoming A2A `message/send` requests to actual OpenClaw sessions
- Returns real OpenClaw responses as A2A Tasks

---

## Implementation Plan

### Phase 1: Study Gateway Plugin SDK (30 min)

1. **Examine existing plugin structure**
   - [x] Studied `telemetry` plugin example
   - Key APIs: `registerCli`, `registerGatewayMethod`, `registerService`
   - Plugin manifest: `openclaw.plugin.json`

2. **Identify required APIs**
   - Need: Session message sending
   - Need: Session event listening (for async responses)
   - Check: What Gateway APIs expose session control?

### Phase 2: Design Plugin Architecture (30 min)

1. **Plugin Structure**
   ```
   plugins/a2a/
   ├── openclaw.plugin.json    # Plugin manifest
   ├── package.json            # Dependencies
   ├── index.ts                # Main plugin entry
   ├── src/
   │   ├── relay-client.ts     # WebSocket relay connection
   │   ├── a2a-types.ts        # A2A protocol types
   │   ├── session-bridge.ts   # Routes A2A → OpenClaw sessions
   │   └── task-store.ts       # Tracks A2A tasks
   └── README.md
   ```

2. **Integration Points**
   - **Service:** Long-running relay connection
   - **CLI:** `openclaw a2a start|stop|status`
   - **RPC:** `a2a.status`, `a2a.connect`, `a2a.disconnect`

### Phase 3: Session Integration (1-2 hrs)

This is the key challenge. Options:

**Option A: Use Gateway Internal APIs**
- Call internal session dispatch directly
- Pros: Clean, proper integration
- Cons: May not be public API

**Option B: Use sessionSendMessage RPC**
- Gateway has RPC for sending to sessions
- Need to find exact method name
- Pros: Uses existing infrastructure

**Option C: Emit synthetic channel messages**
- Register A2A as a channel adapter
- Pros: Cleanest long-term approach
- Cons: Most complex to implement

**Recommended:** Start with Option B (RPC), migrate to Option C later.

### Phase 4: Implement Core Plugin (2-3 hrs)

1. Create plugin scaffold (`plugins/a2a/`)
2. Copy and adapt relay client code
3. Implement session bridge:
   - `message/send` → Create OpenClaw session → Forward message → Wait for response
   - Map A2A `contextId` to OpenClaw session key
4. Wire up CLI commands
5. Add configuration schema

### Phase 5: Testing (1 hr)

1. Unit tests for message routing
2. E2E test: Client → Relay → Plugin → OpenClaw → Response
3. Integration with existing TCK

### Phase 6: Documentation (30 min)

1. Update README with Gateway plugin instructions
2. Add configuration examples
3. Document session mapping

---

## Key Questions to Answer

1. **How does Gateway expose session APIs?**
   - Check `registerGatewayMethod` capabilities
   - Look for `sessions.*` RPC methods

2. **How to get async responses from sessions?**
   - Events? Callbacks? Polling?
   - OpenClaw sessions are async - need to handle wait/callback

3. **What about streaming (message/stream)?**
   - Gateway likely supports SSE or streaming
   - Phase 2 feature

---

## Dependencies

- `openclaw/plugin-sdk` - For plugin API types
- Existing `relay-client.ts` - Can be reused
- Existing `a2a-types.ts` - Can be reused

---

## Next Steps

1. [ ] Explore Gateway session APIs (`registerGatewayMethod` patterns)
2. [ ] Find how telemetry or other plugins interact with sessions
3. [ ] Create minimal plugin scaffold
4. [ ] Implement connection to relay
5. [ ] Implement session message forwarding
6. [ ] Test end-to-end

---

## Notes

- The telemetry plugin shows good patterns for services and CLI
- Main challenge is the session integration layer
- Can run alongside existing simulator during development
