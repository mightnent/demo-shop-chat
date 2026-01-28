"use client";

import React, { useMemo, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Message } from "@/lib/chat-store";
import { mcpClient, UIResource } from "@/lib/mcp-client";
import { UIActionResult, UIResourceRenderer } from "@mcp-ui/client";
import { Bot, User, Loader2 } from "lucide-react";
import { RenderMode } from "@/lib/render-mode-store";
import { CheckoutCard } from "./checkout-card";

interface MessageBubbleProps {
  message: Message;
  onUIAction?: (action: UIActionResult) => Promise<unknown>;
  onCompleteCheckout?: (checkoutId: string) => Promise<void>;
  renderMode?: RenderMode;
}

function normalizeResourceForRenderer(resource: any) {
  if (!resource) return resource;
  
  // UIResourceRenderer only recognizes exact "text/html", not "text/html;profile=mcp-app"
  // Normalize MCP Apps profile MIME type to standard text/html for rendering
  if (resource.mimeType?.startsWith("text/html")) {
    return { ...resource, mimeType: "text/html" };
  }
  return resource;
}

export function MessageBubble({ message, onUIAction, onCompleteCheckout, renderMode = "classic" }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const [mcpAppsResource, setMcpAppsResource] = useState<UIResource | null>(null);
  const [isLoadingMcpApps, setIsLoadingMcpApps] = useState(false);
  const [mcpAppsError, setMcpAppsError] = useState<string | null>(null);

  // In MCP Apps mode, fetch the resource via resources/read using _meta.ui.resourceUri
  useEffect(() => {
    if (renderMode === "mcp-apps" && message.mcpAppsResourceUri && message.serverUrl) {
      setIsLoadingMcpApps(true);
      setMcpAppsError(null);
      mcpClient
        .readResource(message.serverUrl, message.mcpAppsResourceUri)
        .then((resource) => {
          if (resource) {
            setMcpAppsResource(resource);
          } else {
            setMcpAppsError("Failed to fetch MCP Apps resource");
          }
        })
        .catch((err) => {
          setMcpAppsError(err instanceof Error ? err.message : "Unknown error");
        })
        .finally(() => {
          setIsLoadingMcpApps(false);
        });
    } else if (renderMode === "classic") {
      // Clear MCP Apps state when switching to classic mode
      setMcpAppsResource(null);
      setMcpAppsError(null);
    }
  }, [renderMode, message.mcpAppsResourceUri, message.serverUrl]);

  // In classic mode, normalize MIME type so UIResourceRenderer can handle text/html;profile=mcp-app
  // In MCP Apps mode, use the fetched resource from resources/read
  const normalizedResource = useMemo(() => {
    if (renderMode === "mcp-apps") {
      // Use fetched MCP Apps resource (already has text/html;profile=mcp-app)
      // Normalize it so UIResourceRenderer can render it
      return mcpAppsResource ? normalizeResourceForRenderer(mcpAppsResource) : null;
    }
    // Classic mode: use embedded resource from tool result
    if (!message.uiResource) return null;
    return normalizeResourceForRenderer(message.uiResource);
  }, [message.uiResource, renderMode, mcpAppsResource]);

  return (
    <div
      className={cn(
        "flex gap-3 w-full",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarFallback
          className={cn(
            isUser ? "bg-primary text-primary-foreground" : "bg-muted"
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>

      <div
        className={cn(
          "flex flex-col gap-2",
          isUser ? "items-end max-w-[80%]" : "items-start max-w-full"
        )}
      >
        <Card
          className={cn(
            "px-4 py-3",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 text-foreground"
          )}
        >
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        </Card>

        {message.toolCall && (
          <Card className="px-3 py-2 bg-muted/30 border-dashed text-xs text-muted-foreground">
            <span className="font-medium">Tool: </span>
            {message.toolCall.name}
          </Card>
        )}

        {renderMode === "mcp-apps" && isLoadingMcpApps && (
          <div className="w-full flex items-center gap-2 p-4 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
            <Loader2 className="h-4 w-4 animate-spin" />
            Fetching MCP Apps resource via resources/read...
          </div>
        )}

        {renderMode === "mcp-apps" && mcpAppsError && (
          <div className="w-full p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
            MCP Apps Error: {mcpAppsError}
          </div>
        )}

        {message.ucpCheckout && (
          <div className="w-full" style={{ maxWidth: "500px" }}>
            <CheckoutCard
              checkout={message.ucpCheckout}
              onCompleteCheckout={onCompleteCheckout}
            />
          </div>
        )}

        {normalizedResource && (
          <div className="w-full" style={{ minWidth: "600px", maxWidth: "900px" }}>
            {renderMode === "mcp-apps" && (
              <div className="mb-2 px-2 py-1 bg-blue-50 border border-blue-200 rounded text-xs text-blue-700">
                MCP Apps Mode: fetched via resources/read ({message.mcpAppsResourceUri})
              </div>
            )}
            {renderMode === "classic" && (
              <div className="mb-2 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600">
                Classic Mode: using embedded resource from tool result
              </div>
            )}
            <UIResourceRenderer
              resource={normalizedResource}
              onUIAction={onUIAction}
              htmlProps={{
                autoResizeIframe: { width: false, height: true },
                style: {
                  width: "100%",
                  minHeight: "400px",
                  border: "none",
                  display: "block",
                },
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
