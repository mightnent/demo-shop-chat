import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import OpenAI from "openai";
import {
  moderateInput,
  moderateOutput,
  getSystemInstructions,
  clearSystemInstructionsCache,
} from "@/lib/guardrails";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";

type ChatRequest = {
  messages?: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  tool_choice?: OpenAI.Responses.ToolChoiceOptions;
  model?: string;
};

type ProxyToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type ProxyResponse = {
  model: string;
  assistantMessage: {
    content: string;
    toolCalls: ProxyToolCall[];
  };
};

function contentToText(
  content: OpenAI.Chat.Completions.ChatCompletionMessageParam["content"]
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if ("text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("\n")
    .trim();
}

function normalizeRole(
  role: OpenAI.Chat.Completions.ChatCompletionMessageParam["role"]
): OpenAI.Responses.EasyInputMessage["role"] {
  if (role === "user" || role === "assistant" || role === "system" || role === "developer") {
    return role;
  }
  return "user";
}

function toResponsesInput(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): OpenAI.Responses.ResponseInput {
  return messages.map((msg) => ({
    role: normalizeRole(msg.role),
    content: contentToText(msg.content),
  }));
}

function toResponsesTools(
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[]
): OpenAI.Responses.Tool[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: (tool.function.parameters as Record<string, unknown>) || {},
    strict: false,
  }));
}

function extractToolCalls(response: OpenAI.Responses.Response): ProxyToolCall[] {
  return response.output
    .filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === "function_call"
    )
    .map((item) => ({
      id: item.id || item.call_id,
      type: "function",
      function: {
        name: item.name,
        arguments: item.arguments || "{}",
      },
    }));
}

export async function POST(request: Request) {
  try {
    // Skip auth check in demo mode
    if (process.env.NEXT_PUBLIC_AUTH_ENABLED === "true") {
      await requireAuth();
    }

    const body = (await request.json()) as ChatRequest;
    const { messages, tools, tool_choice, model } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array required" },
        { status: 400 }
      );
    }

    // ── Guardrail: Input Moderation ──
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const latestUserText = lastUserMsg ? contentToText(lastUserMsg.content) : "";
    const inputCheck = await moderateInput(openai, latestUserText);
    if (inputCheck.blocked) {
      const payload: ProxyResponse = {
        model: model || DEFAULT_MODEL,
        assistantMessage: { content: inputCheck.refusalMessage, toolCalls: [] },
      };
      return NextResponse.json(payload);
    }

    // ── Guardrail: System Instructions (from editable md file) ──
    if (process.env.NODE_ENV === "development") clearSystemInstructionsCache();
    const systemInstructions = process.env.GUARDRAILS_ENABLED === "true"
      ? getSystemInstructions()
      : undefined;

    const inputMessages = toResponsesInput(messages);

    const response = await openai.responses.create({
      model: model || DEFAULT_MODEL,
      instructions: systemInstructions,
      input: inputMessages,
      tools: toResponsesTools(tools),
      tool_choice: tools?.length ? (tool_choice || "auto") : undefined,
    });

    // ── Guardrail: Output Moderation ──
    const assistantText = response.output_text || "";
    const outputCheck = await moderateOutput(openai, assistantText);

    const payload: ProxyResponse = {
      model: response.model,
      assistantMessage: {
        content: outputCheck.blocked ? outputCheck.refusalMessage : assistantText,
        toolCalls: outputCheck.blocked ? [] : extractToolCalls(response),
      },
    };

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[api/chat] Error:", error);
    return NextResponse.json(
      { error: "Chat request failed" },
      { status: 500 }
    );
  }
}
