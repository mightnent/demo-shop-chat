import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

export interface MCPServer {
  name: string;
  url: string;
  description?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPSession {
  sessionId: string;
  server: MCPServer;
  tools: MCPTool[];
  client: Client;
}

export interface UIResource {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

export interface ToolResult {
  content: Array<{
    type: string;
    text?: string;
    resource?: UIResource;
  }>;
  isError?: boolean;
  _meta?: {
    ui?: {
      resourceUri?: string;
    };
  };
}

class MCPClient {
  private sessions: Map<string, MCPSession> = new Map();
  private sessionIds: Map<string, string> = new Map();

  async connect(server: MCPServer): Promise<MCPSession> {
    const capabilities: ClientCapabilities = {
      roots: { listChanged: true },
    };

    const client = new Client(
      { name: "chat-host", version: "1.0.0" },
      { capabilities }
    );

    const initResponse = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities,
          clientInfo: {
            name: "chat-host",
            version: "1.0.0",
          },
        },
      }),
    });

    const sessionId = initResponse.headers.get("MCP-Session-Id");
    if (!sessionId) {
      throw new Error("No session ID returned from server");
    }

    this.sessionIds.set(server.url, sessionId);

    await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    const toolsResponse = await fetch(server.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      }),
    });

    const toolsData = await toolsResponse.json();
    const tools: MCPTool[] = toolsData.result?.tools || [];

    const session: MCPSession = {
      sessionId,
      server,
      tools,
      client,
    };

    this.sessions.set(server.url, session);
    return session;
  }

  async callTool(
    serverUrl: string,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<ToolResult> {
    const sessionId = this.sessionIds.get(serverUrl);
    if (!sessionId) {
      throw new Error("Not connected to server");
    }

    const response = await fetch(serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
          name: toolName,
          arguments: args,
        },
      }),
    });

    const data = await response.json();
    return data.result as ToolResult;
  }

  async readResource(serverUrl: string, uri: string): Promise<UIResource | null> {
    const sessionId = this.sessionIds.get(serverUrl);
    if (!sessionId) {
      throw new Error("Not connected to server");
    }

    const response = await fetch(serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "resources/read",
        params: { uri },
      }),
    });

    const data = await response.json();
    if (data.error) {
      return null;
    }
    return data.result?.contents?.[0] || null;
  }

  getSession(serverUrl: string): MCPSession | undefined {
    return this.sessions.get(serverUrl);
  }

  getClient(serverUrl: string): Client | undefined {
    return this.sessions.get(serverUrl)?.client;
  }

  getAllTools(): MCPTool[] {
    const allTools: MCPTool[] = [];
    this.sessions.forEach((session) => {
      allTools.push(...session.tools);
    });
    return allTools;
  }

  getToolsWithServer(): Array<{ tool: MCPTool; serverUrl: string }> {
    const result: Array<{ tool: MCPTool; serverUrl: string }> = [];
    this.sessions.forEach((session, serverUrl) => {
      session.tools.forEach((tool) => {
        result.push({ tool, serverUrl });
      });
    });
    return result;
  }
}

export const mcpClient = new MCPClient();
