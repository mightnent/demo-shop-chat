"use client";

import React, { useEffect, useRef, useState } from "react";
import OpenAI from "openai";
import { UIActionResult } from "@mcp-ui/client";
import {
  Menu,
  PanelLeftOpen,
  PanelRightClose,
  SquarePen,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";

import { LoginDialog } from "@/components/auth/login-dialog";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { chatStore, ChatState, Message, MessageCitation } from "@/lib/chat-store";
import { mcpClient, MCPSession } from "@/lib/mcp-client";
import { getMockBuyerInfo, IS_DEMO_MODE } from "@/lib/mock-user";
import { RenderMode, renderModeStore } from "@/lib/render-mode-store";
import {
  UcpCheckoutData,
  isUcpCheckoutTool,
  parseUcpCheckoutResponse,
} from "@/lib/ucp-utils";

import { ChatInput } from "./chat-input";
import { MessageBubble } from "./message-bubble";
import { ServerPanel } from "./server-panel";
import { SlideOutMenu } from "./slide-out-menu";

const DEFAULT_MODEL = process.env.NEXT_PUBLIC_OPENAI_MODEL || "gpt-5.2";
const MOCK_WALLET_STORAGE_KEY = "chat_host_mock_wallet_enabled";
const MCP_SERVERS_STORAGE_KEY = "mcpSavedServers";
const DEFAULT_MCP_SERVER_URL = process.env.NEXT_PUBLIC_DEFAULT_MCP_SERVER_URL?.trim() || "";
const DEFAULT_MCP_SERVER_NAME = process.env.NEXT_PUBLIC_DEFAULT_MCP_SERVER_NAME?.trim();

function getToolText(result: any): string {
  if (!result || !result.content) return "";
  return result.content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
    .join("\n");
}

function buildMockPaymentPayload(checkoutId?: string) {
  const instrumentId = checkoutId ? `instr_${checkoutId}` : `instr_${crypto.randomUUID()}`;
  return {
    payment: {
      instruments: [
        {
          id: instrumentId,
          handler_id: "mock_handler_1",
          type: "token",
          selected: true,
          credential: { type: "mock_token", token: "tok_demo" },
        },
      ],
    },
    risk_signals: {
      biometric_confirmation: {
        approved: true,
        method: "mock_faceid",
      },
      biometric_confirmed: true,
    },
  };
}

function detectCardBrand(cardNumber: string): string {
  if (/^4\d+/.test(cardNumber)) return "visa";
  if (/^5[1-5]\d+/.test(cardNumber)) return "mastercard";
  if (/^3[47]\d+/.test(cardNumber)) return "amex";
  if (/^6(?:011|5\d{2})\d+/.test(cardNumber)) return "discover";
  return "card";
}

function injectUcpMeta(
  toolName: string,
  args: Record<string, unknown>,
  options?: { mockWalletEnabled?: boolean }
): Record<string, unknown> {
  if (!isUcpCheckoutTool(toolName)) return args;

  const mockWalletEnabled = options?.mockWalletEnabled === true;
  const meta = (args.meta || {}) as Record<string, unknown>;

  if (!meta["ucp-agent"]) {
    meta["ucp-agent"] = {
      profile: "https://chat-host.local/profiles/shopping-agent.json",
    };
  }

  if ((toolName === "complete_checkout" || toolName === "cancel_checkout") && !meta["idempotency-key"]) {
    meta["idempotency-key"] = crypto.randomUUID();
  }

  if (toolName === "complete_checkout" && !args.idempotency_key) {
    args.idempotency_key = meta["idempotency-key"];
  }

  if (toolName === "create_checkout" || toolName === "update_checkout") {
    const checkout = (args.checkout || {}) as Record<string, unknown>;

    if (!checkout.buyer) {
      checkout.buyer = getMockBuyerInfo();
    }

    if (mockWalletEnabled && !checkout.payment) {
      const mockPayment = buildMockPaymentPayload(typeof args.id === "string" ? args.id : undefined);
      checkout.payment = mockPayment.payment;
      checkout.risk_signals = {
        ...(checkout.risk_signals as Record<string, unknown> | undefined),
        ...mockPayment.risk_signals,
      };
    }

    return { ...args, meta, checkout };
  }

  if (toolName === "complete_checkout" && mockWalletEnabled) {
    const checkout = (args.checkout || {}) as Record<string, unknown>;

    if (!checkout.payment || !checkout.risk_signals) {
      const mockPayment = buildMockPaymentPayload(typeof args.id === "string" ? args.id : undefined);
      checkout.payment = checkout.payment || mockPayment.payment;
      checkout.risk_signals = {
        ...(checkout.risk_signals as Record<string, unknown> | undefined),
        ...mockPayment.risk_signals,
      };
      return { ...args, meta, checkout };
    }
  }

  return { ...args, meta };
}

async function streamOpenAI(params: {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  onDelta: (chunk: string) => void;
  onDone: (payload: {
    model: string;
    content: string;
    citations: MessageCitation[];
  }) => void;
}): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: params.messages,
      model: DEFAULT_MODEL,
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Chat request failed (${res.status})`);
  }

  if (!res.body) {
    throw new Error("Streaming response body missing");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const parseEvent = (rawEvent: string) => {
    const lines = rawEvent.split("\n");
    let event = "message";
    let data = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data += line.slice(5).trimStart();
      }
    }

    if (!data) return;
    const parsed = JSON.parse(data) as Record<string, unknown>;

    if (event === "delta" && typeof parsed.text === "string") {
      params.onDelta(parsed.text);
      return;
    }

    if (event === "done") {
      params.onDone({
        model: typeof parsed.model === "string" ? parsed.model : DEFAULT_MODEL,
        content: typeof parsed.content === "string" ? parsed.content : "",
        citations: Array.isArray(parsed.citations)
          ? (parsed.citations as MessageCitation[])
          : [],
      });
      return;
    }

    if (event === "error") {
      throw new Error(
        typeof parsed.message === "string" ? parsed.message : "Streaming error"
      );
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let delimiterIndex = buffer.indexOf("\n\n");
    while (delimiterIndex !== -1) {
      const rawEvent = buffer.slice(0, delimiterIndex);
      buffer = buffer.slice(delimiterIndex + 2);
      if (rawEvent.trim()) {
        parseEvent(rawEvent);
      }
      delimiterIndex = buffer.indexOf("\n\n");
    }
  }
}

function shadowPersistMessage(
  sessionId: string | null,
  role: string,
  content: string,
  modelName?: string,
  richMeta?: {
    citations?: MessageCitation[];
    uiResource?: any;
    mcpAppsResourceUri?: string;
    serverUrl?: string;
    ucpCheckout?: any;
    toolCall?: { name: string; args: Record<string, unknown>; result?: string };
  }
) {
  if (IS_DEMO_MODE || !sessionId) return;
  const metadata = richMeta && Object.keys(richMeta).some((k) => (richMeta as any)[k] != null) ? richMeta : undefined;
  fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, role, content, modelName, metadata }),
  }).catch(() => {});
}

export function ChatContainer() {
  const [state, setState] = useState<ChatState>(chatStore.getState());
  const [sessions, setSessions] = useState<MCPSession[]>([]);
  const [showServers, setShowServers] = useState(false);
  const [renderMode, setRenderMode] = useState<RenderMode>(renderModeStore.getMode());
  const [dbSessionId, setDbSessionId] = useState<string | null>(null);
  const [slideOutOpen, setSlideOutOpen] = useState(false);
  const [mockWalletEnabled, setMockWalletEnabled] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { isAdmin, isAuthenticated, isLoading } = useAuth();
  const canManageMcpServers = isAdmin;
  const isAuthEnabled = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

  const normalizeServerUrl = (input: string) => {
    const normalized = new URL(input.trim());
    normalized.hash = "";
    normalized.search = "";
    return normalized.toString().replace(/\/$/, "");
  };

  const buildServer = (url: string, fallbackName?: string) => {
    const normalizedUrl = normalizeServerUrl(url);
    const parsed = new URL(normalizedUrl);
    return {
      name: fallbackName?.trim() || parsed.hostname,
      url: normalizedUrl,
    };
  };

  const dedupeServers = (servers: Array<{ name: string; url: string }>) => {
    const seen = new Set<string>();
    return servers.filter((server) => {
      if (seen.has(server.url)) return false;
      seen.add(server.url);
      return true;
    });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(MOCK_WALLET_STORAGE_KEY);
    if (stored !== null) {
      setMockWalletEnabled(stored === "true");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MOCK_WALLET_STORAGE_KEY, String(mockWalletEnabled));
  }, [mockWalletEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const storedRaw = window.localStorage.getItem(MCP_SERVERS_STORAGE_KEY);
    const storedServers: Array<{ name?: string; url: string }> = storedRaw ? JSON.parse(storedRaw) : [];

    const normalizedStored = storedServers
      .map((server) => {
        try {
          return buildServer(server.url, server.name);
        } catch {
          return null;
        }
      })
      .filter((server): server is { name: string; url: string } => Boolean(server));

    const defaults: Array<{ name: string; url: string }> = [];
    if (DEFAULT_MCP_SERVER_URL) {
      try {
        defaults.push(buildServer(DEFAULT_MCP_SERVER_URL, DEFAULT_MCP_SERVER_NAME));
      } catch {
        // Ignore invalid env URL.
      }
    }

    const initialServers = dedupeServers([...normalizedStored, ...defaults]);
    if (!initialServers.length) return;

    let cancelled = false;

    (async () => {
      const connected = await Promise.all(
        initialServers.map(async (server) => {
          try {
            return await mcpClient.connect(server);
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;
      setSessions(connected.filter((session): session is MCPSession => Boolean(session)));
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (IS_DEMO_MODE || !isAuthenticated) return;
    fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.session?.id) setDbSessionId(data.session.id);
      })
      .catch(() => {});
  }, [isAuthenticated]);

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

  const handleLoadSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/messages?sessionId=${sessionId}`);
      if (!res.ok) return;
      const data = await res.json();
      const loaded: Message[] = (data.messages || []).map((m: any) => {
        const meta = m.metadata || {};
        return {
          id: m.id,
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
          timestamp: new Date(m.createdAt),
          citations: meta.citations || undefined,
          uiResource: meta.uiResource || undefined,
          mcpAppsResourceUri: meta.mcpAppsResourceUri || undefined,
          serverUrl: meta.serverUrl || undefined,
          ucpCheckout: meta.ucpCheckout || undefined,
          toolCall: meta.toolCall || undefined,
        };
      });
      chatStore.setMessages(loaded);
      setDbSessionId(sessionId);
    } catch {
      // silently fail
    }
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
      const args = injectUcpMeta(
        "complete_checkout",
        {
          id: checkoutId,
          checkout: buildMockPaymentPayload(checkoutId),
        },
        { mockWalletEnabled }
      );

      const result = await mcpClient.callTool(match.serverUrl, "complete_checkout", args);
      const checkoutData = parseUcpCheckoutResponse(result);

      const messageContent = checkoutData
        ? `Checkout ${checkoutData.id} - Status: ${checkoutData.status}`
        : getToolText(result) || "Payment processed. Unable to retrieve order details.";

      chatStore.addMessage({
        role: "assistant",
        content: messageContent,
        ucpCheckout: checkoutData || undefined,
        serverUrl: match.serverUrl,
      });
      shadowPersistMessage(dbSessionId, "assistant", messageContent, undefined, {
        ucpCheckout: checkoutData || undefined,
        serverUrl: match.serverUrl,
      });
    } catch (error) {
      const errMsg = `Error completing checkout: ${error instanceof Error ? error.message : "Unknown error"}`;
      chatStore.addMessage({ role: "assistant", content: errMsg });
    } finally {
      chatStore.setLoading(false);
    }
  };

  const handleEcpComplete = (checkout: UcpCheckoutData | undefined, serverUrl?: string) => {
    if (!checkout) return;

    const messageContent = "Payment completed.";

    chatStore.addMessage({
      role: "assistant",
      content: messageContent,
      ucpCheckout: checkout,
      serverUrl,
    });
    shadowPersistMessage(dbSessionId, "assistant", messageContent, undefined, {
      ucpCheckout: checkout,
      serverUrl,
    });
  };

  const handleSubmitPaymentCredential = async (
    checkoutId: string,
    payload: {
      cardNumber: string;
      expiryMonth: string;
      expiryYear: string;
      cvc: string;
      cardholderName?: string;
    }
  ) => {
    const toolsWithServer = mcpClient.getToolsWithServer();
    const match = toolsWithServer.find((t) => t.tool.name === "update_checkout");
    if (!match) {
      throw new Error("update_checkout tool not available");
    }

    const digits = payload.cardNumber.replace(/\D+/g, "");
    const last4 = digits.slice(-4);
    const brand = detectCardBrand(digits);
    const token = `tok_manual_${checkoutId}_${Date.now()}`;

    const args = injectUcpMeta(
      "update_checkout",
      {
        id: checkoutId,
        checkout: {
          payment: {
            instruments: [
              {
                id: `instr_manual_${checkoutId}`,
                handler_id: "mock_handler_1",
                type: "token",
                selected: true,
                credential: {
                  type: "mock_token",
                  token,
                  brand,
                  last4,
                  exp_month: payload.expiryMonth,
                  exp_year: payload.expiryYear,
                  holder_name: payload.cardholderName,
                },
              },
            ],
          },
          risk_signals: {
            biometric_confirmation: {
              approved: true,
              method: "mock_faceid",
              source: "chat_host_manual_card_entry",
            },
            biometric_confirmed: true,
          },
        },
      },
      { mockWalletEnabled: false }
    );

    const result = await mcpClient.callTool(match.serverUrl, "update_checkout", args);
    const checkoutData = parseUcpCheckoutResponse(result);
    const textSummary = checkoutData
      ? `Checkout ${checkoutData.id} - Status: ${checkoutData.status}`
      : getToolText(result) || "Payment credential saved.";

    chatStore.addMessage({
      role: "assistant",
      content: `${textSummary}\nMock wallet enabled for this chat session.`,
      ucpCheckout: checkoutData || undefined,
      serverUrl: match.serverUrl,
    });
    shadowPersistMessage(
      dbSessionId,
      "assistant",
      `${textSummary}\nMock wallet enabled for this chat session.`,
      undefined,
      {
        ucpCheckout: checkoutData || undefined,
        serverUrl: match.serverUrl,
      }
    );

    setMockWalletEnabled(true);
  };

  const handleUIAction = async (action: UIActionResult) => {
    if (action.type === "tool" && action.payload?.toolName) {
      const toolsWithServer = mcpClient.getToolsWithServer();
      const match = toolsWithServer.find((t) => t.tool.name === action.payload.toolName);

      if (match) {
        chatStore.setLoading(true);
        try {
          const actionToolName = action.payload.toolName;
          const actionArgs = injectUcpMeta(actionToolName, action.payload.params || {}, {
            mockWalletEnabled,
          });

          const result = await mcpClient.callTool(match.serverUrl, actionToolName, actionArgs);

          if (isUcpCheckoutTool(actionToolName)) {
            const checkoutData = parseUcpCheckoutResponse(result);
            const content = checkoutData
              ? `Checkout ${checkoutData.id} - Status: ${checkoutData.status}`
              : getToolText(result) || `Tool ${actionToolName} executed.`;
            chatStore.addMessage({
              role: "assistant",
              content,
              ucpCheckout: checkoutData || undefined,
              serverUrl: match.serverUrl,
            });
            shadowPersistMessage(dbSessionId, "assistant", content, undefined, {
              ucpCheckout: checkoutData || undefined,
              serverUrl: match.serverUrl,
            });
          } else {
            const uiResource = result.content.find(
              (c) => c.type === "resource" && c.resource?.uri?.startsWith("ui://")
            );
            const content = `Tool ${actionToolName} executed.`;
            chatStore.addMessage({
              role: "assistant",
              content,
              uiResource: uiResource?.resource,
              mcpAppsResourceUri: result._meta?.ui?.resourceUri,
              serverUrl: match.serverUrl,
            });
            shadowPersistMessage(dbSessionId, "assistant", content, undefined, {
              uiResource: uiResource?.resource,
              mcpAppsResourceUri: result._meta?.ui?.resourceUri,
              serverUrl: match.serverUrl,
            });
          }
        } catch (error) {
          chatStore.addMessage({
            role: "assistant",
            content: `Error executing tool: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        } finally {
          chatStore.setLoading(false);
        }
      }
    }
  };

  const handleSendMessage = async (content: string) => {
    chatStore.addMessage({ role: "user", content });
    shadowPersistMessage(dbSessionId, "user", content);
    chatStore.setLoading(true);

    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        ...state.messages.map((msg) => ({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        })),
        { role: "user", content },
      ];

      const assistant = chatStore.addMessage({
        role: "assistant",
        content: "",
      });
      let runningContent = "";
      let modelUsed = DEFAULT_MODEL;
      let finalCitations: MessageCitation[] = [];

      await streamOpenAI({
        messages,
        onDelta: (chunk) => {
          runningContent += chunk;
          chatStore.updateMessage(assistant.id, { content: runningContent });
        },
        onDone: (payload) => {
          modelUsed = payload.model;
          runningContent = payload.content || runningContent;
          finalCitations = payload.citations || [];
          chatStore.updateMessage(assistant.id, {
            content: runningContent,
            citations: finalCitations,
          });
        },
      });

      if (runningContent.trim()) {
        shadowPersistMessage(dbSessionId, "assistant", runningContent, modelUsed, {
          citations: finalCitations,
        });
      }
    } catch (error) {
      chatStore.addMessage({
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    } finally {
      chatStore.setLoading(false);
    }
  };

  if (isAuthEnabled && isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Checking session...</p>
      </div>
    );
  }

  if (isAuthEnabled && !isAuthenticated) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background p-6">
        <LoginDialog />
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 bg-background">
      {canManageMcpServers && showServers && (
        <aside className="w-72 border-r p-4 hidden md:flex md:flex-col">
          <ServerPanel sessions={sessions} onSessionsChange={setSessions} />

          <div className="mt-auto pt-4 border-t">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  {renderMode === "classic" ? "Classic MCP-UI" : "MCP Apps"}
                </span>
                <Button variant="outline" size="sm" onClick={toggleRenderMode} className="gap-2">
                  {renderMode === "classic" ? (
                    <ToggleLeft className="h-4 w-4" />
                  ) : (
                    <ToggleRight className="h-4 w-4 text-primary" />
                  )}
                  {renderMode === "classic" ? "Classic" : "MCP Apps"}
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">Mock Wallet (Dev)</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setMockWalletEnabled((v) => !v)}
                >
                  {mockWalletEnabled ? (
                    <ToggleRight className="h-4 w-4 text-primary" />
                  ) : (
                    <ToggleLeft className="h-4 w-4" />
                  )}
                  {mockWalletEnabled ? "On" : "Off"}
                </Button>
              </div>
            </div>
          </div>
        </aside>
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        <header className="border-b px-3 py-3 sm:px-4 sm:py-4 flex items-center gap-2 sm:gap-3">
          {canManageMcpServers && (
            <Button
              variant="ghost"
              size="icon"
              className="inline-flex"
              onClick={() => setShowServers((prev) => !prev)}
              aria-label={showServers ? "Hide MCP server panel" : "Show MCP server panel"}
            >
              {showServers ? (
                <PanelRightClose className="h-5 w-5" />
              ) : (
                <PanelLeftOpen className="h-5 w-5" />
              )}
            </Button>
          )}
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Chat</h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              chatStore.clearMessages();
              setDbSessionId(null);
              if (!IS_DEMO_MODE && isAuthenticated) {
                fetch("/api/sessions", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                })
                  .then((res) => res.json())
                  .then((data) => {
                    if (data.session?.id) setDbSessionId(data.session.id);
                  })
                  .catch(() => {});
              }
            }}
            aria-label="New chat"
            className="h-9 w-9"
          >
            <SquarePen className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSlideOutOpen(true)}
            aria-label="Open menu"
            className="h-9 w-9"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </header>

        {canManageMcpServers && showServers && (
          <section className="border-b p-3 md:hidden max-h-[42vh] overflow-y-auto">
            <ServerPanel sessions={sessions} onSessionsChange={setSessions} />
          </section>
        )}

        <ScrollArea className="flex-1 overflow-x-hidden px-3 py-4 sm:p-6" ref={scrollRef}>
          <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
            {state.messages.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Ask about Income motor claims.</p>
              </div>
            ) : (
              state.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  onUIAction={handleUIAction}
                  onCompleteCheckout={handleCompleteCheckout}
                  onSubmitPaymentCredential={handleSubmitPaymentCredential}
                  onEcpComplete={handleEcpComplete}
                  renderMode={renderMode}
                  mockWalletEnabled={mockWalletEnabled}
                />
              ))
            )}
          </div>
        </ScrollArea>

        <footer className="border-t p-3 sm:p-4">
          <div className="max-w-3xl mx-auto w-full">
            <ChatInput
              onSend={handleSendMessage}
              disabled={state.isLoading}
              placeholder="Ask about accident steps, claims process, or forms..."
            />
          </div>
        </footer>
      </main>

      <SlideOutMenu
        open={slideOutOpen}
        onClose={() => setSlideOutOpen(false)}
        onNewChat={() => {
          chatStore.clearMessages();
          setDbSessionId(null);
          if (!IS_DEMO_MODE && isAuthenticated) {
            fetch("/api/sessions", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            })
              .then((res) => res.json())
              .then((data) => {
                if (data.session?.id) setDbSessionId(data.session.id);
              })
              .catch(() => {});
          }
        }}
        onLoadSession={handleLoadSession}
        activeSessionId={dbSessionId}
      />
    </div>
  );
}
