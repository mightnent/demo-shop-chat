"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { mcpClient, MCPServer, MCPSession } from "@/lib/mcp-client";
import { Plus, Server, Wrench, Loader2, Check, X, ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";
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

  const handleDeleteServer = (serverUrl: string) => {
    // Remove from saved servers
    const updatedServers = savedServers.filter((s) => s.url !== serverUrl);
    setSavedServers(updatedServers);
    persistServers(updatedServers);

    // Remove from statuses
    setStatuses((prev) => {
      const updated = { ...prev };
      delete updated[serverUrl];
      return updated;
    });
    setStatusErrors((prev) => {
      const updated = { ...prev };
      delete updated[serverUrl];
      return updated;
    });

    // Disconnect the session if it exists
    const updatedSessions = sessions.filter((s) => s.server.url !== serverUrl);
    if (updatedSessions.length !== sessions.length) {
      onSessionsChange(updatedSessions);
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
      return <Check className="h-3 w-3 text-success" />;
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
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => connectAndTrack(server)}
                        disabled={statuses[server.url] === "connecting"}
                      >
                        Retry
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleDeleteServer(server.url)}
                        title="Delete server"
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
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
                        <Link href="/ucp">
                          <Badge variant="success" className="gap-1 text-[10px] flex-shrink-0 cursor-pointer hover:opacity-80">
                            <ShieldCheck className="h-3 w-3" />
                            UCP
                          </Badge>
                        </Link>
                      ) : (
                        <Link href="/ucp">
                          <Badge variant="warning" className="gap-1 text-[10px] flex-shrink-0 cursor-pointer hover:opacity-80">
                            <ShieldAlert className="h-3 w-3" />
                            Partial
                          </Badge>
                        </Link>
                      )}
                    </div>

                    {/* UCP Compliance Details */}
                    <div className="text-[10px] space-y-1 border-t pt-2">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span>Checkout Tools</span>
                        <span className={compliance.hasCheckout ? "text-success" : "text-warning"}>
                          {compliance.presentRequired.length}/5
                        </span>
                      </div>
                      {compliance.missingRequired.length > 0 && (
                        <div className="text-[10px] text-warning">
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
                                ? "bg-success/10 text-success border border-success/20"
                                : "bg-muted/50 text-muted-foreground"
                            )}
                          >
                            <Wrench className="h-3 w-3" />
                            <span className="truncate">{tool.name}</span>
                            {isUcpTool && (
                              <Badge variant="success" className="ml-auto text-[9px] px-1.5 py-0">
                                UCP
                              </Badge>
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
