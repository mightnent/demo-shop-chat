"use client";

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mcpClient, MCPServer, MCPSession } from "@/lib/mcp-client";
import {
  checkUcpCompliance,
  UcpComplianceResult,
  UCP_REQUIRED_TOOLS,
  UCP_OPTIONAL_TOOLS,
  validateUcpProfile,
  UcpProfileCheckResult,
} from "@/lib/ucp-utils";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Server,
  Check,
  X,
  Loader2,
  Plus,
  ArrowLeft,
  RefreshCw,
  CreditCard,
  ShoppingCart,
  Package,
} from "lucide-react";
import Link from "next/link";

interface ServerComplianceInfo {
  server: MCPServer;
  session?: MCPSession;
  compliance?: UcpComplianceResult;
  profileCheck?: UcpProfileCheckResult;
  status: "idle" | "connecting" | "connected" | "error";
  error?: string;
}

const STORAGE_KEY = "mcpSavedServers";

export default function UcpCompliancePage() {
  const [serverUrl, setServerUrl] = useState("");
  const [servers, setServers] = useState<ServerComplianceInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const fetchUcpProfile = async (server: MCPServer) => {
    const baseUrl = new URL(server.url).origin;
    const response = await fetch(`${baseUrl}/.well-known/ucp`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Profile fetch failed (${response.status})`);
    }
    return response.json();
  };

  const loadAndScanServers = async () => {
    setIsScanning(true);

    const storedRaw = localStorage.getItem(STORAGE_KEY);
    const stored: MCPServer[] = storedRaw ? JSON.parse(storedRaw) : [];
    const allServers = [...stored];

    const serverInfos: ServerComplianceInfo[] = allServers.map((server) => ({
      server,
      status: "idle" as const,
    }));

    setServers(serverInfos);

    for (let i = 0; i < serverInfos.length; i++) {
      const info = serverInfos[i];
      setServers((prev) =>
        prev.map((s, idx) =>
          idx === i ? { ...s, status: "connecting" } : s
        )
      );

      try {
        const session = await mcpClient.connect(info.server);
        const compliance = checkUcpCompliance(session.tools);
        const profile = await fetchUcpProfile(info.server);
        const profileCheck = validateUcpProfile(profile, info.server.url);

        setServers((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: "connected", session, compliance, profileCheck }
              : s
          )
        );
      } catch (err) {
        setServers((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? {
                  ...s,
                  status: "error",
                  error: err instanceof Error ? err.message : "Connection failed",
                }
              : s
          )
        );
      }
    }

    setIsScanning(false);
  };

  useEffect(() => {
    loadAndScanServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddServer = async () => {
    if (!serverUrl.trim()) return;

    const newServer: MCPServer = {
      name: new URL(serverUrl).hostname,
      url: serverUrl,
    };

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    stored.push(newServer);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

    const newInfo: ServerComplianceInfo = {
      server: newServer,
      status: "connecting",
    };

    setServers((prev) => [...prev, newInfo]);
    setServerUrl("");

    try {
      const session = await mcpClient.connect(newServer);
      const compliance = checkUcpCompliance(session.tools);
      const profile = await fetchUcpProfile(newServer);
      const profileCheck = validateUcpProfile(profile, newServer.url);

      setServers((prev) =>
        prev.map((s) =>
          s.server.url === newServer.url
            ? { ...s, status: "connected", session, compliance, profileCheck }
            : s
        )
      );
    } catch (err) {
      setServers((prev) =>
        prev.map((s) =>
          s.server.url === newServer.url
            ? {
                ...s,
                status: "error",
                error: err instanceof Error ? err.message : "Connection failed",
              }
            : s
        )
      );
    }
  };

  const compliantCount = servers.filter((s) => s.compliance?.isCompliant).length;
  const partialCount = servers.filter(
    (s) => s.status === "connected" && !s.compliance?.isCompliant
  ).length;
  const errorCount = servers.filter((s) => s.status === "error").length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              UCP Compliance Center
            </h1>
            <p className="text-sm text-muted-foreground">
              Verify MCP server compliance with Universal Commerce Protocol
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadAndScanServers}
            disabled={isScanning}
          >
            {isScanning ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Rescan All
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">
                  <Server className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{servers.length}</p>
                  <p className="text-xs text-muted-foreground">Total Servers</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-success/10">
                  <ShieldCheck className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-success">{compliantCount}</p>
                  <p className="text-xs text-muted-foreground">UCP Compliant</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-warning/10">
                  <ShieldAlert className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-warning">{partialCount}</p>
                  <p className="text-xs text-muted-foreground">Partial</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-destructive/10">
                  <ShieldX className="h-5 w-5 text-destructive" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-destructive">{errorCount}</p>
                  <p className="text-xs text-muted-foreground">Unreachable</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Add Server */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Add MCP Server</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://example.com/api/mcp"
                className="flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleAddServer()}
              />
              <Button onClick={handleAddServer} disabled={!serverUrl.trim()}>
                <Plus className="h-4 w-4 mr-2" />
                Add & Scan
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Server List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Server Compliance Status</h2>

          {servers.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                No servers configured. Add a server to check UCP compliance.
              </CardContent>
            </Card>
          ) : (
            servers.map((info) => (
              <Card key={info.server.url} className="overflow-hidden">
                <CardHeader className="pb-3">
                  {(() => {
                    const profileErrors = info.profileCheck?.errors || [];
                    const profileWarnings = info.profileCheck?.warnings || [];
                    const toolOk = info.compliance?.isCompliant ?? false;
                    const profileOk = profileErrors.length === 0;
                    const isCompliant = toolOk && profileOk;
                    return (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {info.status === "connecting" && (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      )}
                      {info.status === "connected" && isCompliant && (
                        <ShieldCheck className="h-5 w-5 text-success" />
                      )}
                      {info.status === "connected" && !isCompliant && (
                        <ShieldAlert className="h-5 w-5 text-warning" />
                      )}
                      {info.status === "error" && (
                        <ShieldX className="h-5 w-5 text-destructive" />
                      )}
                      {info.status === "idle" && (
                        <Server className="h-5 w-5 text-muted-foreground" />
                      )}
                      <div>
                        <CardTitle className="text-base">{info.server.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {info.server.url}
                        </CardDescription>
                      </div>
                    </div>

                    {isCompliant && (
                      <Badge variant="success" className="gap-2 text-sm px-3 py-1">
                        <Check className="h-4 w-4" />
                        UCP Compliant
                      </Badge>
                    )}
                    {info.status === "connected" && !isCompliant && (
                      <Badge variant="warning" className="gap-2 text-sm px-3 py-1">
                        <ShieldAlert className="h-4 w-4" />
                        Partial Compliance
                      </Badge>
                    )}
                    {info.status === "error" && (
                      <Badge variant="destructive" className="gap-2 text-sm px-3 py-1">
                        <X className="h-4 w-4" />
                        Connection Failed
                      </Badge>
                    )}
                  </div>
                    );
                  })()}
                </CardHeader>

                {info.status === "error" && (
                  <CardContent className="pt-0">
                    <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg border border-destructive/20">
                      {info.error}
                    </div>
                  </CardContent>
                )}

                {info.status === "connected" && info.compliance && (
                  <CardContent className="pt-0 space-y-4">
                    {info.profileCheck && (
                      <div className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">Profile Discovery</span>
                          <Badge
                            variant={info.profileCheck.errors.length === 0 ? "success" : "destructive"}
                            className="ml-auto text-xs"
                          >
                            {info.profileCheck.errors.length === 0
                              ? "Valid"
                              : `${info.profileCheck.errors.length} issue(s)`}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                          /.well-known/ucp • MCP service + checkout capability + spec/schema URLs
                        </div>
                        <div className="space-y-1">
                          {info.profileCheck.errors.map((err) => (
                            <div
                              key={err}
                              className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-destructive/10 text-destructive"
                            >
                              <X className="h-3 w-3" />
                              {err}
                            </div>
                          ))}
                          {info.profileCheck.warnings.map((warn) => (
                            <div
                              key={warn}
                              className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-warning/10 text-warning"
                            >
                              <ShieldAlert className="h-3 w-3" />
                              {warn}
                            </div>
                          ))}
                          {info.profileCheck.errors.length === 0 &&
                            info.profileCheck.warnings.length === 0 && (
                              <div className="text-xs text-success bg-success/10 px-2 py-1 rounded">
                                Profile metadata looks valid.
                              </div>
                            )}
                        </div>
                      </div>
                    )}

                    {/* UCP Version */}
                    {info.compliance.ucpVersion && (
                      <div className="text-sm text-muted-foreground">
                        UCP Version: <span className="font-mono">{info.compliance.ucpVersion}</span>
                      </div>
                    )}

                    {/* Capability Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Checkout Tools */}
                      <div className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">Checkout Tools</span>
                          <Badge
                            variant={info.compliance.hasCheckout ? "success" : "warning"}
                            className="ml-auto text-xs"
                          >
                            {info.compliance.presentRequired.length}/{UCP_REQUIRED_TOOLS.length}
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          {UCP_REQUIRED_TOOLS.map((tool) => {
                            const hasIt = info.compliance?.presentRequired.includes(tool);
                            return (
                              <div
                                key={tool}
                                className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${
                                  hasIt ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                                }`}
                              >
                                {hasIt ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <X className="h-3 w-3" />
                                )}
                                <span className="font-mono">{tool}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Product Tools */}
                      <div className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <Package className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">Product Tools</span>
                          <Badge variant="info" className="ml-auto text-xs">
                            {info.compliance.presentOptional.length}/{UCP_OPTIONAL_TOOLS.length}
                          </Badge>
                        </div>
                        <div className="space-y-1">
                          {UCP_OPTIONAL_TOOLS.map((tool) => {
                            const hasIt = info.compliance?.presentOptional.includes(tool);
                            return (
                              <div
                                key={tool}
                                className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${
                                  hasIt ? "bg-info/10 text-info" : "bg-muted text-muted-foreground"
                                }`}
                              >
                                {hasIt ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <span className="h-3 w-3 text-center">—</span>
                                )}
                                <span className="font-mono">{tool}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Payment Handlers */}
                      <div className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <CreditCard className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">Payment Handlers</span>
                        </div>
                        {info.compliance.paymentHandlers.length > 0 ? (
                          <div className="space-y-1">
                            {info.compliance.paymentHandlers.map((handler) => (
                              <div
                                key={handler}
                                className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-secondary text-secondary-foreground"
                              >
                                <Check className="h-3 w-3" />
                                <span className="font-mono">{handler}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground italic">
                            Payment handlers will be detected from checkout responses
                          </div>
                        )}
                      </div>
                    </div>

                    {/* All Tools */}
                    <div className="border-t pt-4">
                      <div className="text-sm font-medium mb-2">
                        All Available Tools ({info.session?.tools.length || 0})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {info.session?.tools.map((tool) => {
                          const isUcp = info.compliance?.presentRequired.includes(tool.name);
                          const isOptional = info.compliance?.presentOptional.includes(tool.name);
                          return (
                            <Badge
                              key={tool.name}
                              variant={isUcp ? "success" : isOptional ? "info" : "outline"}
                              className="text-xs"
                            >
                              {tool.name}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            ))
          )}
        </div>

        {/* UCP Spec Reference */}
        <Card className="bg-muted/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-4">
              <ShieldCheck className="h-6 w-6 text-primary mt-0.5" />
              <div>
                <h3 className="font-medium mb-1">About UCP Compliance</h3>
                <p className="text-sm text-muted-foreground mb-2">
                  Universal Commerce Protocol (UCP) defines a standard for agentic commerce.
                  A compliant MCP server must implement all 5 checkout tools to enable the
                  full checkout flow.
                </p>
                <div className="text-xs text-muted-foreground">
                  <strong>Required tools:</strong> create_checkout, get_checkout, update_checkout, complete_checkout, cancel_checkout
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
