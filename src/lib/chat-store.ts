import { v4 as uuidv4 } from "uuid";
import { UIResource } from "./mcp-client";
import type { UcpCheckoutData } from "./ucp-utils";

export interface MessageCitation {
  title: string;
  url: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  citations?: MessageCitation[];
  uiResource?: UIResource;
  mcpAppsResourceUri?: string;
  serverUrl?: string;
  ucpCheckout?: UcpCheckoutData;
  toolCall?: {
    name: string;
    args: Record<string, unknown>;
    result?: string;
  };
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
}

class ChatStore {
  private state: ChatState = {
    messages: [],
    isLoading: false,
  };
  private listeners: Set<() => void> = new Set();

  getState(): ChatState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  addMessage(message: Omit<Message, "id" | "timestamp">): Message {
    const newMessage: Message = {
      ...message,
      id: uuidv4(),
      timestamp: new Date(),
    };
    this.state = {
      ...this.state,
      messages: [...this.state.messages, newMessage],
    };
    this.notify();
    return newMessage;
  }

  updateMessage(id: string, updates: Partial<Message>): void {
    this.state = {
      ...this.state,
      messages: this.state.messages.map((msg) =>
        msg.id === id ? { ...msg, ...updates } : msg
      ),
    };
    this.notify();
  }

  setLoading(isLoading: boolean): void {
    this.state = { ...this.state, isLoading };
    this.notify();
  }

  setMessages(messages: Message[]): void {
    this.state = { ...this.state, messages };
    this.notify();
  }

  clearMessages(): void {
    this.state = { ...this.state, messages: [] };
    this.notify();
  }
}

export const chatStore = new ChatStore();
