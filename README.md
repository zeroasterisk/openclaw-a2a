# OpenClaw A2A

> ⚠️ **Beta** — Tested and working. Shipping today!

**A2A channel plugin for [OpenClaw](https://openclaw.ai).** Let other AI agents discover and talk to your OpenClaw — or talk to other A2A agents.

## Quick Start

### 1. Add the Plugin

```bash
# Clone into your extensions
git clone https://github.com/zeroasterisk/openclaw-a2a ~/.openclaw/extensions/a2a
```

### 2. Configure

```json
{
  "plugins": {
    "load": { "paths": ["~/.openclaw/extensions/a2a"] },
    "entries": { "a2a": { "enabled": true } }
  },
  "channels": {
    "a2a": {
      "enabled": true,
      "accounts": {
        "default": {
          "relayUrl": "wss://your-relay.example.com/agent",
          "relaySecret": "your-32-char-jwt-secret",
          "agentId": "my-agent"
        }
      }
    }
  }
}
```

### 3. Restart & Verify

```bash
openclaw gateway restart
openclaw a2a status
```

```
📡 A2A Status
🟢 Connected
   Relay: wss://your-relay.example.com/agent
   Agent: my-agent
```

## How It Works

```
Other Agents ──► A2A Relay ◄── Your OpenClaw
                    │
              WebSocket connection
              (works behind NAT)
```

A2A is treated as a **channel** — like Telegram or Discord. Messages come in via A2A, route to your agent, responses go back.

## Config Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `relayUrl` | ✅ | - | WebSocket URL (`wss://...`) |
| `relaySecret` | ✅ | - | JWT secret (32+ chars) |
| `agentId` | - | `openclaw` | Your agent's ID |
| `tenant` | - | `default` | Tenant namespace |
| `agentName` | - | `OpenClaw Agent` | Display name |
| `autoStart` | - | `true` | Connect on gateway start |

## Optional: Enable OPT

OPT (Objective-Plan-Task) adds hierarchical task management:

```json
{
  "channels": {
    "a2a": {
      "enabled": true,
      "opt": { "enabled": true },
      "accounts": { ... }
    }
  }
}
```

Creates methods: `a2a.opt.objectives.*`, `a2a.opt.plans.*`, `a2a.opt.tasks.*`

See [A2A OPT Extension](https://github.com/zeroasterisk/a2a-opt) for the spec.

## CLI Commands

```bash
openclaw a2a status      # Check connection
openclaw a2a connect     # Manual connect
openclaw a2a disconnect  # Disconnect
openclaw a2a reset       # Reset retry counter
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Auth failed | Check `relaySecret` matches relay |
| Won't connect | Check relay URL, see `/tmp/a2a-plugin.log` |
| Messages not routing | Ensure `gateway.auth.token` is set |

## Related Repos

| Repo | Description |
|------|-------------|
| [a2a-relay](https://github.com/zeroasterisk/a2a-relay) | Relay server (Go) |
| [a2a-opt](https://github.com/zeroasterisk/a2a-opt) | OPT extension spec |
| [openclaw-a2a](https://github.com/zeroasterisk/openclaw-a2a) | This plugin (you are here) |

## Architecture

The plugin registers as an OpenClaw channel:
- **relay-client.ts** — WebSocket connection to relay
- **handlers.ts** — A2A protocol handlers
- **channel.ts** — OpenClaw channel adapter
- **opt/** — Optional OPT extension

## A2A Protocol

- [A2A Spec](https://a2a-protocol.org)
- [A2A GitHub](https://github.com/google/A2A)

## License

Apache-2.0
