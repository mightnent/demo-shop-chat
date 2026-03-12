import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import OpenAI from "openai";
import {
  assessClaimsScope,
  getClaimsScopeRefusalMessage,
  isSimpleSmallTalk,
  moderateInput,
  moderateOutput,
  getSystemInstructions,
  clearSystemInstructionsCache,
} from "@/lib/guardrails";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const FIRST_TURN_GREETING =
  "Hi, I can help with Income motor claims questions. What happened, and what claim step do you need help with?";
const CLAIMS_ALLOWED_URL_PREFIX =
  process.env.CLAIMS_ALLOWED_URL_PREFIX || "https://www.income.com.sg/claims";
const CLAIMS_ALLOWED_DOMAIN =
  process.env.CLAIMS_ALLOWED_DOMAIN || "income.com.sg";
const SEARCH_MAX_TOOL_CALLS = Number.parseInt(
  process.env.SEARCH_MAX_TOOL_CALLS || "2",
  10
);
const CLAIMS_CACHE_TTL_SECONDS = Number.parseInt(
  process.env.CLAIMS_CACHE_TTL_SECONDS || "900",
  10
);

type ChatRequest = {
  messages?: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  model?: string;
  stream?: boolean;
};

type Citation = {
  title: string;
  url: string;
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
    citations?: Citation[];
  };
};

type CachedResponse = {
  content: string;
  citations: Citation[];
  expiresAtMs: number;
};

const claimsResponseCache = new Map<string, CachedResponse>();

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

function isSimpleGreeting(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(hi|hello|hey|yo|sup|howdy)[!.?]*$/.test(normalized);
}

function normalizeQuestion(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ");
}

function isAllowedClaimsUrl(url: string): boolean {
  try {
    const normalizedPrefix = CLAIMS_ALLOWED_URL_PREFIX.endsWith("/")
      ? CLAIMS_ALLOWED_URL_PREFIX
      : `${CLAIMS_ALLOWED_URL_PREFIX}/`;
    return url === CLAIMS_ALLOWED_URL_PREFIX || url.startsWith(normalizedPrefix);
  } catch {
    return false;
  }
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];

  for (const citation of citations) {
    if (!citation.url) continue;
    if (!isAllowedClaimsUrl(citation.url)) continue;
    if (seen.has(citation.url)) continue;
    seen.add(citation.url);
    result.push(citation);
  }

  return result;
}

function extractCitations(response: OpenAI.Responses.Response): Citation[] {
  const citations: Citation[] = [];
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type !== "output_text") continue;
      const annotations = part.annotations || [];
      for (const annotation of annotations) {
        const maybeCitation = annotation as OpenAI.Responses.ResponseOutputText.URLCitation;
        if (maybeCitation.type !== "url_citation") continue;
        citations.push({
          title: maybeCitation.title || "Source",
          url: maybeCitation.url,
        });
      }
    }
  }

  return dedupeCitations(citations);
}

function countWebSearchCalls(response: OpenAI.Responses.Response): number {
  return response.output.filter((item) => item.type === "web_search_call").length;
}

function extractConsultedSourceUrls(response: OpenAI.Responses.Response): string[] {
  const urls = new Set<string>();

  for (const item of response.output as unknown as Array<Record<string, unknown>>) {
    if (item.type !== "web_search_call") continue;
    const action = item.action as { sources?: Array<{ url?: string }> } | undefined;
    const sources = Array.isArray(action?.sources) ? action.sources : [];
    for (const source of sources) {
      if (source.url) urls.add(source.url);
    }
  }

  return Array.from(urls);
}

function buildTargetedSearchHint(text: string): string {
  const normalized = text.toLowerCase();

  if (normalized.includes("stolen") || normalized.includes("theft")) {
    return "Focus on stolen vehicle motor claims process, required documents, and direct form/PDF links on income.com.sg/claims.";
  }

  if (normalized.includes("accident")) {
    return "Focus on immediate post-accident steps, reporting timelines, and motor claim process on income.com.sg/claims.";
  }

  if (
    normalized.includes("form") ||
    normalized.includes("pdf") ||
    normalized.includes("document") ||
    normalized.includes("submit")
  ) {
    return "Focus on exact form names, required documents, and direct claim PDF links on income.com.sg/claims.";
  }

  return "Focus on Income motor claims steps and requirements from income.com.sg/claims pages.";
}

function buildFallbackSearchHint(text: string): string {
  return `Deep search within income.com.sg claims pages only for this request: ${text}`;
}

function isCacheEntryFresh(entry: CachedResponse): boolean {
  return Date.now() < entry.expiresAtMs;
}

function shouldRunWebSearch(text: string): boolean {
  return !isSimpleSmallTalk(text);
}

function buildSearchRequestParams(args: {
  model: string;
  input: OpenAI.Responses.ResponseInput;
  instructions?: string;
  searchHint: string;
  maxToolCalls: number;
  cacheKey: string;
}): OpenAI.Responses.ResponseCreateParamsNonStreaming {
  const withHint: OpenAI.Responses.ResponseInput = [
    ...args.input,
    {
      role: "developer",
      content: `Search policy: ${args.searchHint} Only cite URLs under ${CLAIMS_ALLOWED_URL_PREFIX}.`,
    },
  ];

  return {
    model: args.model,
    instructions: args.instructions,
    input: withHint,
    tool_choice: "auto",
    tools: [
      {
        type: "web_search_preview",
        search_context_size: "medium",
      } as unknown as OpenAI.Responses.Tool,
    ],
    include: [
      "web_search_call.action.sources",
    ] as unknown as OpenAI.Responses.ResponseIncludable[],
    max_tool_calls: Math.max(1, args.maxToolCalls),
    prompt_cache_key: `claims:${args.cacheKey}`,
  } as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming;
}

function removeUnsupportedParam(
  params: Record<string, unknown>,
  paramPath: string
): boolean {
  if (paramPath === "include" || paramPath.startsWith("include[")) {
    if ("include" in params) {
      delete params.include;
      return true;
    }
    return false;
  }

  if (paramPath === "max_tool_calls") {
    if ("max_tool_calls" in params) {
      delete params.max_tool_calls;
      return true;
    }
    return false;
  }

  if (paramPath === "prompt_cache_key") {
    if ("prompt_cache_key" in params) {
      delete params.prompt_cache_key;
      return true;
    }
    return false;
  }

  if (paramPath.startsWith("tools[")) {
    const tools = params.tools as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(tools) || tools.length === 0) return false;

    if (paramPath.includes(".filters")) {
      if ("filters" in tools[0]) {
        delete tools[0].filters;
        return true;
      }
      return false;
    }
  }

  return false;
}

async function createResponseWithFallback(
  params: OpenAI.Responses.ResponseCreateParamsNonStreaming
): Promise<OpenAI.Responses.Response> {
  const mutableParams = structuredClone(
    params as unknown as Record<string, unknown>
  ) as Record<string, unknown>;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await openai.responses.create(
        mutableParams as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming
      );
    } catch (error) {
      const err = error as {
        code?: string;
        param?: string;
        status?: number;
      };
      const unknownParam = err.code === "unknown_parameter" && typeof err.param === "string";
      if (!unknownParam) throw error;

      const changed = removeUnsupportedParam(mutableParams, err.param!);
      if (!changed) throw error;
    }
  }

  throw new Error("Unable to create response after fallback retries");
}

async function createResponseStreamWithFallback(
  params: OpenAI.Responses.ResponseCreateParamsStreaming
): Promise<AsyncIterable<OpenAI.Responses.ResponseStreamEvent>> {
  const mutableParams = structuredClone(
    params as unknown as Record<string, unknown>
  ) as Record<string, unknown>;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return (await openai.responses.create(
        mutableParams as unknown as OpenAI.Responses.ResponseCreateParamsStreaming
      )) as AsyncIterable<OpenAI.Responses.ResponseStreamEvent>;
    } catch (error) {
      const err = error as {
        code?: string;
        param?: string;
      };
      const unknownParam = err.code === "unknown_parameter" && typeof err.param === "string";
      if (!unknownParam) throw error;

      const changed = removeUnsupportedParam(mutableParams, err.param!);
      if (!changed) throw error;
    }
  }

  throw new Error("Unable to create response stream after fallback retries");
}

function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function buildNonSearchRequestParams(args: {
  model: string;
  input: OpenAI.Responses.ResponseInput;
  instructions?: string;
}): OpenAI.Responses.ResponseCreateParamsNonStreaming {
  return {
    model: args.model,
    instructions: args.instructions,
    input: args.input,
  };
}

export async function POST(request: Request) {
  try {
    // Skip auth check in demo mode
    if (process.env.NEXT_PUBLIC_AUTH_ENABLED === "true") {
      await requireAuth();
    }

    const body = (await request.json()) as ChatRequest;
    const { messages, model, stream } = body;
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const wantsStream = stream === true;

    if (!messages || !Array.isArray(messages)) {
      if (wantsStream) {
        return new Response(sseEvent("error", { message: "messages array required" }), {
          status: 400,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
          },
        });
      }
      return NextResponse.json({ error: "messages array required" }, { status: 400 });
    }

    // ── Guardrail: Input Moderation ──
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const latestUserText = lastUserMsg ? contentToText(lastUserMsg.content) : "";
    const inputCheck = await moderateInput(openai, latestUserText);
    if (inputCheck.blocked) {
      const payload: ProxyResponse = {
        model: model || DEFAULT_MODEL,
        assistantMessage: {
          content: inputCheck.refusalMessage,
          toolCalls: [],
          citations: [],
        },
      };
      if (wantsStream) {
        const text = inputCheck.refusalMessage;
        return new Response(
          `${sseEvent("delta", { text })}${sseEvent("done", {
            model: model || DEFAULT_MODEL,
            content: text,
            citations: [],
          })}`,
          {
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          }
        );
      }
      return NextResponse.json(payload);
    }

    // Keep first-turn greeting deterministic and short.
    const userMessageCount = messages.filter((m) => m.role === "user").length;
    if (userMessageCount === 1 && isSimpleGreeting(latestUserText)) {
      const payload: ProxyResponse = {
        model: model || DEFAULT_MODEL,
        assistantMessage: {
          content: FIRST_TURN_GREETING,
          toolCalls: [],
          citations: [],
        },
      };
      if (wantsStream) {
        return new Response(
          `${sseEvent("delta", { text: FIRST_TURN_GREETING })}${sseEvent("done", {
            model: model || DEFAULT_MODEL,
            content: FIRST_TURN_GREETING,
            citations: [],
          })}`,
          {
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          }
        );
      }
      return NextResponse.json(payload);
    }

    const scope = assessClaimsScope(latestUserText);
    if (!scope.inScope) {
      console.info("[api/chat] claims_scope_refusal", {
        requestId,
        latestUserText,
      });
      const payload: ProxyResponse = {
        model: model || DEFAULT_MODEL,
        assistantMessage: {
          content: getClaimsScopeRefusalMessage(),
          toolCalls: [],
          citations: [],
        },
      };
      if (wantsStream) {
        const text = getClaimsScopeRefusalMessage();
        return new Response(
          `${sseEvent("delta", { text })}${sseEvent("done", {
            model: model || DEFAULT_MODEL,
            content: text,
            citations: [],
          })}`,
          {
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          }
        );
      }
      return NextResponse.json(payload);
    }

    // ── Guardrail: System Instructions (from editable md file) ──
    if (process.env.NODE_ENV === "development") clearSystemInstructionsCache();
    const systemInstructions = process.env.GUARDRAILS_ENABLED === "true"
      ? getSystemInstructions()
      : undefined;

    const inputMessages = toResponsesInput(messages);
    const modelToUse = model || DEFAULT_MODEL;
    const cacheKey = normalizeQuestion(latestUserText);
    const cached = claimsResponseCache.get(cacheKey);
    if (cached && isCacheEntryFresh(cached)) {
      const payload: ProxyResponse = {
        model: modelToUse,
        assistantMessage: {
          content: cached.content,
          toolCalls: [],
          citations: cached.citations,
        },
      };
      console.info("[api/chat] cache_hit", {
        requestId,
        cacheKey,
        citations: cached.citations.map((c) => c.url),
      });
      if (wantsStream) {
        return new Response(
          `${sseEvent("delta", { text: cached.content })}${sseEvent("done", {
            model: modelToUse,
            content: cached.content,
            citations: cached.citations,
          })}`,
          {
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-transform",
              Connection: "keep-alive",
            },
          }
        );
      }
      return NextResponse.json(payload);
    }

    if (wantsStream) {
      const encoder = new TextEncoder();
      const sseHeaders = {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      };

      const streamResponse = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: string, data: Record<string, unknown>) => {
            controller.enqueue(encoder.encode(sseEvent(event, data)));
          };

          const run = async () => {
            const runSearch = shouldRunWebSearch(latestUserText);
            const streamParams = runSearch
              ? ({
                  ...buildSearchRequestParams({
                    model: modelToUse,
                    input: inputMessages,
                    instructions: systemInstructions,
                    searchHint: buildTargetedSearchHint(latestUserText),
                    maxToolCalls: SEARCH_MAX_TOOL_CALLS,
                    cacheKey,
                  }),
                  stream: true,
                } as OpenAI.Responses.ResponseCreateParamsStreaming)
              : ({
                  ...buildNonSearchRequestParams({
                    model: modelToUse,
                    input: inputMessages,
                    instructions: systemInstructions,
                  }),
                  stream: true,
                } as OpenAI.Responses.ResponseCreateParamsStreaming);

            let assistantText = "";
            let completedResponse: OpenAI.Responses.Response | null = null;

            try {
              const responseStream = await createResponseStreamWithFallback(streamParams);

              for await (const event of responseStream) {
                if (event.type === "response.output_text.delta" && event.delta) {
                  assistantText += event.delta;
                  send("delta", { text: event.delta });
                }

                if (event.type === "response.completed") {
                  completedResponse = event.response;
                }
              }

              if (!assistantText && completedResponse?.output_text) {
                assistantText = completedResponse.output_text;
                send("delta", { text: assistantText });
              }

              const citations = completedResponse ? extractCitations(completedResponse) : [];
              const outputCheck = await moderateOutput(openai, assistantText);
              const finalText = outputCheck.blocked
                ? outputCheck.refusalMessage
                : assistantText ||
                  "I couldn’t verify that from Income claims pages. Please rephrase your motor claims question and I’ll try again.";
              const finalCitations = outputCheck.blocked ? [] : citations;

              if (
                !outputCheck.blocked &&
                finalCitations.length > 0 &&
                finalText.trim().length > 0
              ) {
                claimsResponseCache.set(cacheKey, {
                  content: finalText,
                  citations: finalCitations,
                  expiresAtMs: Date.now() + CLAIMS_CACHE_TTL_SECONDS * 1000,
                });
              }

              send("done", {
                model: completedResponse?.model || modelToUse,
                content: finalText,
                citations: finalCitations,
              });
            } catch (error) {
              console.error("[api/chat] stream error", error);
              send("error", {
                message: "Chat request failed",
              });
            } finally {
              controller.close();
            }
          };

          void run();
        },
      });

      return new Response(streamResponse, { headers: sseHeaders });
    }

    const runSearch = shouldRunWebSearch(latestUserText);
    let response: OpenAI.Responses.Response;

    if (!runSearch) {
      response = await createResponseWithFallback(
        buildNonSearchRequestParams({
          model: modelToUse,
          input: inputMessages,
          instructions: systemInstructions,
        })
      );
    } else {
      const firstPass = await createResponseWithFallback(
        buildSearchRequestParams({
          model: modelToUse,
          input: inputMessages,
          instructions: systemInstructions,
          searchHint: buildTargetedSearchHint(latestUserText),
          maxToolCalls: Math.min(SEARCH_MAX_TOOL_CALLS, 1),
          cacheKey,
        })
      );

      const firstPassCitations = extractCitations(firstPass);
      if (firstPassCitations.length > 0) {
        response = firstPass;
      } else {
        response = await createResponseWithFallback(
          buildSearchRequestParams({
            model: modelToUse,
            input: inputMessages,
            instructions: systemInstructions,
            searchHint: buildFallbackSearchHint(latestUserText),
            maxToolCalls: SEARCH_MAX_TOOL_CALLS,
            cacheKey: `${cacheKey}:fallback`,
          })
        );
      }
    }

    // ── Guardrail: Output Moderation ──
    const citations = extractCitations(response);
    const sourceUrls = extractConsultedSourceUrls(response);
    let assistantText = response.output_text || "";
    const webSearchCalls = countWebSearchCalls(response);

    if (runSearch && citations.length === 0) {
      assistantText =
        "I couldn’t verify that from Income claims pages. Please rephrase your motor claims question and I’ll try again.";
    }

    const outputCheck = await moderateOutput(openai, assistantText);
    const finalCitations = outputCheck.blocked ? [] : citations;

    if (!outputCheck.blocked && finalCitations.length > 0) {
      claimsResponseCache.set(cacheKey, {
        content: assistantText,
        citations: finalCitations,
        expiresAtMs: Date.now() + CLAIMS_CACHE_TTL_SECONDS * 1000,
      });
    }

    console.info("[api/chat] request_summary", {
      requestId,
      inScope: scope.inScope,
      matchedKeywords: scope.matchedKeywords,
      webSearchCalls,
      sourceUrls,
      sourceUrlAllowlistViolations: sourceUrls.filter((url) => !isAllowedClaimsUrl(url)).length,
      citedUrls: finalCitations.map((citation) => citation.url),
    });

    const payload: ProxyResponse = {
      model: response.model,
      assistantMessage: {
        content: outputCheck.blocked ? outputCheck.refusalMessage : assistantText,
        toolCalls: outputCheck.blocked ? [] : extractToolCalls(response),
        citations: finalCitations,
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
