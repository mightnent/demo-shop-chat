"use client";

import React, { useState, useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { ChatInput } from "./chat-input";
import { ServerPanel } from "./server-panel";
import { Button } from "@/components/ui/button";
import { chatStore, Message, ChatState } from "@/lib/chat-store";
import { mcpClient, MCPSession, MCPTool } from "@/lib/mcp-client";
import { renderModeStore, RenderMode } from "@/lib/render-mode-store";
import { UIActionResult } from "@mcp-ui/client";
import { PanelLeftOpen, PanelRightClose, ToggleLeft, ToggleRight, User } from "lucide-react";
import { MOCK_USER, getMockBuyerInfo } from "@/lib/mock-user";
import Link from "next/link";
import OpenAI from "openai";
import { isUcpCheckoutTool, parseUcpCheckoutResponse } from "@/lib/ucp-utils";

const openai = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY || "",
  dangerouslyAllowBrowser: true,
});

const UCP_SYSTEM_PROMPT = `You are a helpful agentic commerce copilot using MCP-UI. Keep responses concise, friendly, and action-oriented.

You can:
- Discover products with vendor tools (list_products, get_product, recommend_products).
- Manage checkout via UCP tools (create_checkout, get_checkout, update_checkout, complete_checkout, cancel_checkout).

Checkout flow:
1) Help the user browse and decide what to buy.
2) When they want to purchase, call create_checkout with line_items containing the product ID as a string.
3) If buyer info is missing, call update_checkout to add it (email, first_name, last_name).
4) When status is ready_for_complete, call complete_checkout. If they cancel, call cancel_checkout.

UCP tool argument rules:
- All UCP tools require a meta.ucp-agent.profile URL: "https://chat-host.local/profiles/shopping-agent.json".
- complete_checkout and cancel_checkout also need meta["idempotency-key"] (use any UUID string).
- For get/update/complete/cancel, the checkout session id is top-level, not inside checkout.
- checkout contains domain data (buyer, line_items, currency). Product IDs must be strings.

When presenting checkout results, summarize status and key details conversationally. The checkout card UI renders automatically.`;

function injectUcpMeta(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (!isUcpCheckoutTool(toolName)) return args;

  const meta = (args.meta || {}) as Record<string, unknown>;
  if (!meta["ucp-agent"]) {
    meta["ucp-agent"] = {
      profile: "https://chat-host.local/profiles/shopping-agent.json",
    };
  }
  if (
    (toolName === "complete_checkout" || toolName === "cancel_checkout") &&
    !meta["idempotency-key"]
  ) {
    meta["idempotency-key"] = crypto.randomUUID();
  }

  // Auto-inject mock buyer info for create_checkout and update_checkout
  if (toolName === "create_checkout" || toolName === "update_checkout") {
    const checkout = (args.checkout || {}) as Record<string, unknown>;
    if (!checkout.buyer) {
      checkout.buyer = getMockBuyerInfo();
    }
    return { ...args, meta, checkout };
  }

  return { ...args, meta };
}

export function ChatContainer() {
  const [state, setState] = useState<ChatState>(chatStore.getState());
  const [sessions, setSessions] = useState<MCPSession[]>([]);
  const [showServers, setShowServers] = useState(true);
  const [renderMode, setRenderMode] = useState<RenderMode>(renderModeStore.getMode());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = chatStore.subscribe(() => {
      setState(chatStore.getState());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = renderModeStore.subscribe(() => {
      setRenderMode(renderModeStore.getMode());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state.messages]);

  const toggleRenderMode = () => {
    const newMode = renderMode === "classic" ? "mcp-apps" : "classic";
    renderModeStore.setMode(newMode);
  };

  const handleCompleteCheckout = async (checkoutId: string) => {
    const toolsWithServer = mcpClient.getToolsWithServer();
    const match = toolsWithServer.find((t) => t.tool.name === "complete_checkout");

    if (!match) {
      chatStore.addMessage({
        role: "assistant",
        content: "Error: complete_checkout tool not available",
      });
      return;
    }

    chatStore.setLoading(true);
    try {
      const args = injectUcpMeta("complete_checkout", {
        id: checkoutId,
        checkout: {},
      });

      const result = await mcpClient.callTool(match.serverUrl, "complete_checkout", args);
      console.log("[Checkout] complete_checkout result:", result);
      const checkoutData = parseUcpCheckoutResponse(result);
      console.log("[Checkout] parsed checkoutData:", checkoutData);

      let messageContent: string;
      if (checkoutData) {
        if (checkoutData.status === "completed") {
          const total = checkoutData.totals.find((t) => t.type === "total");
          const itemNames = checkoutData.line_items.map((li) => li.item.title || `Product #${li.item.id}`).join(", ");
          messageContent = `🎉 **Order Placed Successfully!**\n\n**Order #${checkoutData.order?.id || checkoutId}**\n- Items: ${itemNames}\n- Total: $${total ? (total.amount / 100).toFixed(2) : "N/A"}\n\nThank you for your purchase!`;
        } else {
          messageContent = `Checkout ${checkoutData.id} - Status: ${checkoutData.status}`;
        }
      } else {
        messageContent = "Payment processed. Unable to retrieve order details.";
      }

      chatStore.addMessage({
        role: "assistant",
        content: messageContent,
        ucpCheckout: checkoutData || undefined,
        serverUrl: match.serverUrl,
      });
    } catch (error) {
      chatStore.addMessage({
        role: "assistant",
        content: `Error completing checkout: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      chatStore.setLoading(false);
    }
  };

  const handleUIAction = async (action: UIActionResult) => {
    const typedAction = action;

    if (typedAction.type === "tool" && typedAction.payload?.toolName) {
      const toolsWithServer = mcpClient.getToolsWithServer();
      const match = toolsWithServer.find(
        (t) => t.tool.name === typedAction.payload.toolName
      );

      if (match) {
        chatStore.setLoading(true);
        try {
          const actionToolName = typedAction.payload.toolName;
          const actionArgs = injectUcpMeta(
            actionToolName,
            typedAction.payload.params || {}
          );

          const result = await mcpClient.callTool(
            match.serverUrl,
            actionToolName,
            actionArgs
          );

          if (isUcpCheckoutTool(actionToolName)) {
            const checkoutData = parseUcpCheckoutResponse(result);
            chatStore.addMessage({
              role: "assistant",
              content: checkoutData
                ? `Checkout ${checkoutData.id} - Status: ${checkoutData.status}`
                : `Tool ${actionToolName} executed.`,
              ucpCheckout: checkoutData || undefined,
              serverUrl: match.serverUrl,
            });
          } else {
            const uiResource = result.content.find(
              (c) => c.type === "resource" && c.resource?.uri?.startsWith("ui://")
            );

            chatStore.addMessage({
              role: "assistant",
              content: `Tool ${actionToolName} executed.`,
              uiResource: uiResource?.resource,
              mcpAppsResourceUri: result._meta?.ui?.resourceUri,
              serverUrl: match.serverUrl,
            });
          }
        } catch (error) {
          chatStore.addMessage({
            role: "assistant",
            content: `Error executing tool: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          });
        } finally {
          chatStore.setLoading(false);
        }
      }
    }
  };

  const handleSendMessage = async (content: string) => {
    chatStore.addMessage({ role: "user", content });
    chatStore.setLoading(true);

    try {
      const tools = mcpClient.getAllTools();
      const toolsWithServer = mcpClient.getToolsWithServer();

      const openAITools: OpenAI.Chat.Completions.ChatCompletionTool[] =
        tools.map((tool) => ({
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as Record<string, unknown>,
          },
        }));

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: UCP_SYSTEM_PROMPT },
        ...state.messages.map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        })),
        { role: "user", content },
      ];

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        tools: openAITools.length > 0 ? openAITools : undefined,
        tool_choice: openAITools.length > 0 ? "auto" : undefined,
      });

      const choice = response.choices[0];
      const assistantMessage = choice.message;

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          let toolArgs = JSON.parse(toolCall.function.arguments || "{}");

          const match = toolsWithServer.find((t) => t.tool.name === toolName);

          if (match) {
            // Auto-inject UCP meta for checkout tools
            toolArgs = injectUcpMeta(toolName, toolArgs);

            chatStore.addMessage({
              role: "assistant",
              content: `Calling tool: ${toolName}`,
              toolCall: { name: toolName, args: toolArgs },
            });

            const result = await mcpClient.callTool(
              match.serverUrl,
              toolName,
              toolArgs
            );

            // Handle UCP checkout tools differently from vendor tools
            if (isUcpCheckoutTool(toolName)) {
              const checkoutData = parseUcpCheckoutResponse(result);
              const textSummary = checkoutData
                ? `Checkout ${checkoutData.id} - Status: ${checkoutData.status}`
                : "Checkout operation completed.";

              chatStore.addMessage({
                role: "assistant",
                content: textSummary,
                ucpCheckout: checkoutData || undefined,
                serverUrl: match.serverUrl,
              });
            } else {
              // Existing vendor tool handling
              const uiResource = result.content.find(
                (c) =>
                  c.type === "resource" && c.resource?.uri?.startsWith("ui://")
              );

              const textContent = result.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");

              chatStore.addMessage({
                role: "assistant",
                content: textContent || "Tool executed successfully.",
                uiResource: uiResource?.resource,
                mcpAppsResourceUri: result._meta?.ui?.resourceUri,
                serverUrl: match.serverUrl,
              });
            }
          }
        }
      } else if (assistantMessage.content) {
        chatStore.addMessage({
          role: "assistant",
          content: assistantMessage.content,
        });
      }
    } catch (error) {
      chatStore.addMessage({
        role: "assistant",
        content: `Error: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    } finally {
      chatStore.setLoading(false);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {showServers && (
        <aside className="w-72 border-r p-4 hidden md:block">
          <ServerPanel sessions={sessions} onSessionsChange={setSessions} />
        </aside>
      )}

      <main className="flex-1 flex flex-col">
        <header className="border-b px-6 py-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={() => setShowServers((prev) => !prev)}
            aria-label={showServers ? "Hide MCP server panel" : "Show MCP server panel"}
          >
            {showServers ? (
              <PanelRightClose className="h-5 w-5" />
            ) : (
              <PanelLeftOpen className="h-5 w-5" />
            )}
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Chat</h1>
            <p className="text-sm text-muted-foreground">
              Agentic Commerce and Payment Demo
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {renderMode === "classic" ? "Classic MCP-UI" : "MCP Apps"}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleRenderMode}
                className="gap-2"
              >
                {renderMode === "classic" ? (
                  <ToggleLeft className="h-4 w-4" />
                ) : (
                  <ToggleRight className="h-4 w-4 text-primary" />
                )}
                {renderMode === "classic" ? "Classic" : "MCP Apps"}
              </Button>
            </div>
            <div className="flex items-center gap-2 pl-4 border-l">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xs font-medium text-primary">{MOCK_USER.avatarInitials}</span>
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium">{MOCK_USER.firstName} {MOCK_USER.lastName}</p>
                <p className="text-xs text-muted-foreground">{MOCK_USER.email}</p>
              </div>
            </div>
          </div>
        </header>

        <ScrollArea className="flex-1 p-6" ref={scrollRef}>
          <div className="max-w-5xl mx-auto space-y-6">
            {state.messages.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  Start Chatting!
                </p>
              </div>
            ) : (
              state.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onUIAction={handleUIAction}
                  onCompleteCheckout={handleCompleteCheckout}
                  renderMode={renderMode}
                />
              ))
            )}
          </div>
        </ScrollArea>

        <footer className="border-t p-4">
          <div className="max-w-3xl mx-auto">
            <ChatInput
              onSend={handleSendMessage}
              disabled={state.isLoading}
              placeholder="Ask me anything..."
            />
          </div>
        </footer>
      </main>
    </div>
  );
}
