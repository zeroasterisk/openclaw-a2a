# OpenClaw-A2A Roadmap

## ✅ Done

- [x] A2A JSON-RPC server (TCK 100% compliant)
- [x] Core methods: `message/send`, `tasks/get`, `tasks/list`, `tasks/cancel`
- [x] Agent Card generation
- [x] Basic test server

## 🚧 In Progress

### v0.1 — OpenClaw Integration
- [ ] Gateway plugin structure
- [ ] Session mapping (contextId → session)
- [ ] MsgContext adapter
- [ ] Task persistence (SQLite)
- [ ] Task queuing per context (max 9999)

### v0.2 — Relay Mode
- [ ] WebSocket client for relay connection
- [ ] Auto-reconnect with backoff
- [ ] JWT auth from relay

## 📋 Planned

### High Priority

#### OAuth2 / OpenID Connect
- Support standard OAuth2 flows for multi-user scenarios
- Token refresh handling
- Scope-based permissions

#### Additional Auth Schemes
- mTLS for enterprise deployments
- API key rotation
- Auth middleware plugin system

#### OPT Extension Integration
- Import `a2a-opt` types
- Objective/Plan persistence
- History scoping (task / plan / objective level)

### Medium Priority

#### Relay Resilience Testing
- **Agent offline scenarios**: Verify message timeout when backend agent disconnects
- **Queue behavior**: Messages enqueued while agent offline, delivered on reconnect
- **Timeout configuration**: Configurable request timeout (default 30s?)
- **Load testing**: Concurrent message throughput, connection limits
- **Reconnection storms**: Graceful handling when many agents reconnect simultaneously
- **Memory pressure**: Behavior under high pending-request counts

#### Client Mode
- Tools for calling remote A2A agents
- Agent discovery
- Multi-agent orchestration helpers

#### Direct Mode
- HTTP endpoints on gateway
- TLS termination options
- Rate limiting

#### Monitoring
- Prometheus metrics
- Task duration tracking
- Error rate dashboards

### Low Priority

#### Full Streaming
- Stream thinking/reasoning steps
- Real-time tool call events
- Artifact streaming
- Progress percentage updates

#### Push Notifications
- Webhook callbacks
- Polling fallback
- Delivery guarantees

#### Multi-Transport
- gRPC transport option
- REST transport option
- Transport negotiation

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-15 | Queue concurrent tasks (max 9999) | Matches A2A semantics, simple impl |
| 2026-02-15 | History scoping: task/plan/objective | Flexible for OPT use cases |
| 2026-02-15 | Relay-trust + API key for v1 | Simple, OAuth2 on roadmap |
| 2026-02-15 | Basic streaming only for v1 | Covers main use case, full later |
