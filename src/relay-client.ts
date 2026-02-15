/**
 * A2A Relay Client - Connects to relay via WebSocket for NAT traversal
 * 
 * Allows agents without public URLs to receive A2A requests via a relay server.
 */

import WebSocket from 'ws';
import type { AgentCard, JsonRpcRequest, JsonRpcResponse } from './a2a-types.js';

export interface RelayClientConfig {
  /** Relay WebSocket URL (e.g., wss://relay.example.com/agent) */
  relayUrl: string;
  /** JWT token for authentication */
  token: string;
  /** Tenant namespace */
  tenant: string;
  /** Agent ID within tenant */
  agentId: string;
  /** Agent card to register */
  agentCard: AgentCard;
  /** Handler for incoming JSON-RPC requests */
  onRequest: (request: JsonRpcRequest) => Promise<JsonRpcResponse>;
  /** Reconnect on disconnect */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private config: Required<RelayClientConfig>;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private isStopping = false;

  constructor(config: RelayClientConfig) {
    this.config = {
      autoReconnect: true,
      reconnectDelay: 5000,
      ...config,
    };
  }

  async connect(): Promise<void> {
    this.isStopping = false;
    return this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[Relay] Connecting to ${this.config.relayUrl}...`);
      
      this.ws = new WebSocket(this.config.relayUrl);

      this.ws.on('open', () => {
        console.log('[Relay] WebSocket connected, sending auth...');
        this.sendAuth();
      });

      this.ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          await this.handleMessage(msg, resolve);
        } catch (err) {
          console.error('[Relay] Failed to parse message:', err);
        }
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[Relay] WebSocket closed: ${code} ${reason}`);
        this.isConnected = false;
        this.ws = null;
        
        if (!this.isStopping && this.config.autoReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        console.error('[Relay] WebSocket error:', err);
        if (!this.isConnected) {
          reject(err);
        }
      });
    });
  }

  private sendAuth(): void {
    if (!this.ws) return;

    const authMsg = {
      type: 'auth',
      token: this.config.token,
      tenant: this.config.tenant,
      agent_id: this.config.agentId,
      agent_card: this.config.agentCard,
    };

    this.ws.send(JSON.stringify(authMsg));
  }

  private async handleMessage(msg: any, onConnected?: (value: void) => void): Promise<void> {
    // Auth response
    if (msg.type === 'auth_ok') {
      console.log('[Relay] Authenticated successfully');
      this.isConnected = true;
      onConnected?.();
      return;
    }

    if (msg.type === 'auth_error') {
      console.error('[Relay] Auth failed:', msg.error);
      this.ws?.close();
      return;
    }

    // JSON-RPC request from client via relay
    // Relay sends 'a2a.request' type with payload wrapper
    if (msg.type === 'a2a.request' && msg.payload) {
      const requestId = msg.payload.id; // Relay's tracking ID
      // The actual JSON-RPC request is in payload.params (relay wraps it)
      const jsonRpcRequest = msg.payload.params as JsonRpcRequest;
      
      console.log(`[Relay] Received request: ${jsonRpcRequest.method} (relay-id: ${requestId})`);

      try {
        const response = await this.config.onRequest(jsonRpcRequest);
        this.sendResponse(requestId, response);
      } catch (err) {
        console.error('[Relay] Request handler error:', err);
        this.sendResponse(requestId, {
          jsonrpc: '2.0',
          id: jsonRpcRequest.id,
          error: { code: -32603, message: String(err) },
        });
      }
      return;
    }

    // Ping/pong for keepalive
    if (msg.type === 'ping') {
      this.ws?.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    console.log('[Relay] Unknown message type:', msg.type);
  }

  private sendResponse(relayRequestId: string, response: JsonRpcResponse): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[Relay] Cannot send response, WebSocket not open');
      return;
    }

    // Relay expects 'a2a.response' with payload containing {id, result?, error?}
    const msg = {
      type: 'a2a.response',
      payload: {
        id: relayRequestId,
        result: response.result,
        error: response.error,
      },
    };

    this.ws.send(JSON.stringify(msg));
    console.log(`[Relay] Sent response for ${relayRequestId}`);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    
    console.log(`[Relay] Reconnecting in ${this.config.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect().catch((err) => {
        console.error('[Relay] Reconnect failed:', err);
        if (this.config.autoReconnect && !this.isStopping) {
          this.scheduleReconnect();
        }
      });
    }, this.config.reconnectDelay);
  }

  async disconnect(): Promise<void> {
    this.isStopping = true;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.isConnected = false;
    console.log('[Relay] Disconnected');
  }

  get connected(): boolean {
    return this.isConnected;
  }
}

/**
 * Create a simple JWT token for testing (NOT FOR PRODUCTION)
 * In production, tokens should be issued by a proper auth service.
 */
export function createTestToken(payload: {
  tenant: string;
  agent_id?: string;
  user_id?: string;
  role: 'agent' | 'client';
}, secret: string): string {
  // Simple JWT creation (header.payload.signature)
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400, // 24h
  })).toString('base64url');
  
  // Note: This is a simplified signature - use a proper JWT library in production
  const crypto = require('crypto');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  
  return `${header}.${body}.${signature}`;
}
