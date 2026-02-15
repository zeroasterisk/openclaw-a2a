#!/bin/bash
# End-to-end test for A2A Relay flow
# 
# Tests the full CUJ: Client → Relay → Agent → Response
#
# Prerequisites:
#   - Node.js installed
#   - RELAY_SECRET set (JWT signing secret for relay)
#   - Relay must be running and accessible
#
# Usage:
#   RELAY_SECRET=your-secret ./e2e-test.sh [relay-url]
#
# Example:
#   RELAY_SECRET=my-secret ./e2e-test.sh https://a2a-relay-dev.example.com

set -e

RELAY_URL="${1:-http://localhost:8765}"
SECRET="${RELAY_SECRET:?Set RELAY_SECRET environment variable}"
TENANT="e2e-test"
AGENT_ID="test-agent-$$"

echo "========================================"
echo "A2A Relay End-to-End Test"
echo "========================================"
echo "Relay URL: $RELAY_URL"
echo "Tenant: $TENANT"
echo "Agent ID: $AGENT_ID"
echo ""

# Check if relay is accessible
echo "1. Checking relay health..."
HEALTH=$(curl -s "$RELAY_URL/health" 2>/dev/null || echo "FAIL")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "   ✅ Relay is healthy"
else
  echo "   ❌ Relay not accessible at $RELAY_URL"
  echo "   Response: $HEALTH"
  exit 1
fi
echo ""

# Build the project if needed
if [[ ! -f "dist/test-relay-agent.js" ]]; then
  echo "2. Building project..."
  npm run build
  echo "   ✅ Build complete"
else
  echo "2. Using existing build"
fi
echo ""

# Start test agent in background
echo "3. Starting test agent..."
RELAY_URL="${RELAY_URL/http/ws}/agent" \
RELAY_SECRET="$SECRET" \
RELAY_TENANT="$TENANT" \
RELAY_AGENT_ID="$AGENT_ID" \
node dist/test-relay-agent.js &
AGENT_PID=$!

# Give agent time to connect
sleep 3

# Check agent registered
echo "4. Checking agent connected..."
HEALTH=$(curl -s "$RELAY_URL/health")
AGENTS=$(echo "$HEALTH" | grep -o '"agents_connected":[0-9]*' | cut -d: -f2)
if [[ "$AGENTS" -ge 1 ]]; then
  echo "   ✅ Agent connected (total: $AGENTS)"
else
  echo "   ❌ Agent not connected"
  kill $AGENT_PID 2>/dev/null
  exit 1
fi
echo ""

# Generate client JWT
echo "5. Generating client JWT..."
CLIENT_JWT=$(node -e "
const crypto = require('crypto');
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  tenant:'$TENANT',
  user_id:'e2e-tester',
  role:'client',
  iat:Math.floor(Date.now()/1000),
  exp:Math.floor(Date.now()/1000)+3600
})).toString('base64url');
const sig = crypto.createHmac('sha256','$SECRET').update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
")
echo "   ✅ JWT created"
echo ""

# Send test message
echo "6. Sending test message..."
RESPONSE=$(curl -s -X POST \
  "$RELAY_URL/t/$TENANT/a2a/$AGENT_ID/message/send" \
  -H "Authorization: Bearer $CLIENT_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "message/send",
    "params": {
      "message": {
        "messageId": "e2e-test-'$$'",
        "role": "user",
        "parts": [{"text": "Hello from E2E test!"}]
      }
    }
  }')

echo "   Response: $RESPONSE"

if echo "$RESPONSE" | grep -q '"state":"TASK_STATE_COMPLETED"'; then
  echo "   ✅ Message sent and received response"
else
  echo "   ❌ Unexpected response"
  kill $AGENT_PID 2>/dev/null
  exit 1
fi
echo ""

# Extract response text
ECHO_TEXT=$(echo "$RESPONSE" | grep -o '"text":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ "$ECHO_TEXT" == *"E2E test"* ]]; then
  echo "   ✅ Echo response correct: $ECHO_TEXT"
else
  echo "   ⚠️  Unexpected echo: $ECHO_TEXT"
fi
echo ""

# Cleanup
echo "7. Cleaning up..."
kill $AGENT_PID 2>/dev/null
echo "   ✅ Agent stopped"
echo ""

echo "========================================"
echo "✅ All tests passed!"
echo "========================================"
