"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { mcpClient, MCPServer, MCPSession } from "@/lib/mcp-client";
import { Plus, Server, Wrench, Loader2, Check, X, ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkUcpCompliance } from "@/lib/ucp-utils";

interface ServerPanelProps {
  sessions: MCPSession[];
  onSessionsChange: (sessions: MCPSession[]) => void;
}

type ServerStatus = "idle" | "connecting" | "ok" | "error";

const STORAGE_KEY = "mcpSavedServers";

export function ServerPanel({ sessions, onSessionsChange }: ServerPanelProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedServers, setSavedServers] = useState<MCPServer[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServerStatus>>({});
  const [statusErrors, setStatusErrors] = useState<Record<string, string | undefined>>({});

  const persistServers = (servers: MCPServer[]) => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
  };

  const dedupeServers = (servers: MCPServer[]) => {
    const seen = new Set<string>();
    return servers.filter((server) => {
      if (seen.has(server.url)) return false;
      seen.add(server.url);
      return true;
    });
  };

  const connectAndTrack = async (server: MCPServer) => {
    const alreadyConnected = sessions.some((s) => s.server.url === server.url);
    if (alreadyConnected) {
      setStatuses((prev) => ({ ...prev, [server.url]: "ok" }));
      setStatusErrors((prev) => ({ ...prev, [server.url]: undefined }));
      return;
    }

    setStatuses((prev) => ({ ...prev, [server.url]: "connecting" }));
    setStatusErrors((prev) => ({ ...prev, [server.url]: undefined }));

    try {
      const session = await mcpClient.connect(server);
      onSessionsChange([...sessions, session]);
      setStatuses((prev) => ({ ...prev, [server.url]: "ok" }));
    } catch (err) {
      setStatuses((prev) => ({ ...prev, [server.url]: "error" }));
      setStatusErrors((prev) => ({
        ...prev,
        [server.url]: err instanceof Error ? err.message : "Failed to connect",
      }));
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedRaw = localStorage.getItem(STORAGE_KEY);
    const stored: MCPServer[] = storedRaw ? JSON.parse(storedRaw) : [];
    const initial = dedupeServers(stored);

    setSavedServers(initial);
    persistServers(initial);

    initial.forEach((server) => {
      connectAndTrack(server);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    if (!serverUrl.trim()) return;

    setIsConnecting(true);
    setError(null);

    try {
      const server: MCPServer = {
        name: new URL(serverUrl).hostname,
        url: serverUrl,
      };

      const updatedServers = dedupeServers([...savedServers, server]);
      setSavedServers(updatedServers);
      persistServers(updatedServers);

      await connectAndTrack(server);
      setServerUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setIsConnecting(false);
    }
  };

  const shorten = useMemo(
    () =>
      (text: string, max = 22) => {
        if (text.length <= max) return text;
        return `${text.slice(0, max - 1)}…`;
      },
    [],
  );

  const renderStatusIcon = (status: ServerStatus | undefined) => {
    if (status === "connecting") {
      return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
    }
    if (status === "ok") {
      return <Check className="h-3 w-3 text-green-500" />;
    }
    if (status === "error") {
      return <X className="h-3 w-3 text-destructive" />;
    }
    return <Server className="h-3 w-3 text-muted-foreground" />;
  };

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="pb-2 flex items-center gap-2 text-sm font-medium">
        <Server className="h-4 w-4" />
        MCP Servers
      </div>
      <div className="flex-1 flex flex-col gap-4">
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="Server URL..."
              className="text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleConnect()}
            />
            <Button
              size="icon"
              variant="outline"
              onClick={handleConnect}
              disabled={isConnecting || !serverUrl.trim()}
            >
              {isConnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </Button>
          </div>

          {savedServers.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Saved MCP Servers
              </p>
              <div className="space-y-2">
                {savedServers.map((server) => (
                  <div
                    key={server.url}
                    className="flex items-center justify-between rounded border bg-muted/40 px-3 py-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {renderStatusIcon(statuses[server.url])}
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium truncate max-w-[160px]">
                          {shorten(server.name, 40)}
                        </span>
                        <span className="text-[11px] text-muted-foreground truncate max-w-[160px]">
                          {shorten(server.url, 34)}
                        </span>
                        {statuses[server.url] === "error" && statusErrors[server.url] && (
                          <span className="text-[11px] text-destructive truncate">
                            {statusErrors[server.url]}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => connectAndTrack(server)}
                      disabled={statuses[server.url] === "connecting"}
                    >
                      Retry
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="text-xs text-destructive flex items-center gap-1">
            <X className="h-3 w-3" />
            {error}
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="space-y-3">
            {sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No servers connected
              </p>
            ) : (
              sessions.map((session) => {
                const compliance = checkUcpCompliance(session.tools);
                return (
                  <div
                    key={session.sessionId}
                    className="rounded-lg border bg-card p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        {renderStatusIcon(statuses[session.server.url] || "ok")}
                        <span className="text-xs font-medium truncate max-w-[140px]">
                          {shorten(session.server.name, 28)}
                        </span>
                      </div>
                      {compliance.isCompliant ? (
                        <Link
                          href="/ucp"
                          className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded-full border border-green-200 hover:border-green-300 flex-shrink-0"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          UCP
                        </Link>
                      ) : (
                        <Link
                          href="/ucp"
                          className="flex items-center gap-1 text-[10px] text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full border border-yellow-200 hover:border-yellow-300 flex-shrink-0"
                        >
                          <ShieldAlert className="h-3 w-3" />
                          Partial
                        </Link>
                      )}
                    </div>

                    {/* UCP Compliance Details */}
                    <div className="text-[10px] space-y-1 border-t pt-2">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Checkout Tools</span>
                        <span className={compliance.hasCheckout ? "text-green-600" : "text-yellow-600"}>
                          {compliance.presentRequired.length}/5
                        </span>
                      </div>
                      {compliance.missingRequired.length > 0 && (
                        <div className="text-[10px] text-yellow-600">
                          Missing: {compliance.missingRequired.join(", ")}
                        </div>
                      )}
                      {compliance.ucpVersion && (
                        <div className="text-[10px] text-muted-foreground">
                          UCP v{compliance.ucpVersion}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      {session.tools.map((tool) => {
                        const isUcpTool = compliance.presentRequired.includes(tool.name);
                        return (
                          <div
                            key={tool.name}
                            className={cn(
                              "flex items-center gap-2 text-xs",
                              "rounded px-2 py-1",
                              isUcpTool 
                                ? "bg-green-50 text-green-700 border border-green-100"
                                : "bg-muted/50 text-muted-foreground"
                            )}
                          >
                            <Wrench className="h-3 w-3" />
                            <span className="truncate">{tool.name}</span>
                            {isUcpTool && (
                              <span className="ml-auto text-[9px] bg-green-100 px-1.5 py-0.5 rounded">
                                UCP
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
