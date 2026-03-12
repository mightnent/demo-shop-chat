import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import OpenAI from "openai";
import {
  isSimpleSmallTalk,
  moderateInput,
  moderateOutput,
  getSystemInstructions,
  clearSystemInstructionsCache,
} from "@/lib/guardrails";
import { ClaimsRoute, listClaimsRoutesCached } from "@/lib/claims-routes";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-5.2";
const FIRST_TURN_GREETING =
  "Hi, how may I assist you with Income claims today?";
const CLAIMS_ALLOWED_URL_PREFIX =
  process.env.CLAIMS_ALLOWED_URL_PREFIX || "https://www.income.com.sg/claims";
const CLAIMS_ALLOWED_DOMAIN =
  process.env.CLAIMS_ALLOWED_DOMAIN || "income.com.sg";
const CLAIMS_ALLOWED_EXTRA_PDF_HOSTS = (
  process.env.CLAIMS_ALLOWED_EXTRA_PDF_HOSTS || "assets-au-01.kc-usercontent.com"
)
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const CLAIMS_KC_USERCONTENT_HOST =
  process.env.CLAIMS_KC_USERCONTENT_HOST || "assets-au-01.kc-usercontent.com";
const CLAIMS_KC_USERCONTENT_SITE_ID =
  process.env.CLAIMS_KC_USERCONTENT_SITE_ID || "8acbd32f-b7e0-0294-6b7d-a2bc72d6b30c";
const SEARCH_MAX_TOOL_CALLS = Number.parseInt(
  process.env.SEARCH_MAX_TOOL_CALLS || "2",
  10
);
const CLAIMS_CACHE_TTL_SECONDS = Number.parseInt(
  process.env.CLAIMS_CACHE_TTL_SECONDS || "900",
  10
);
const CLAIMS_CACHE_VERSION = process.env.CLAIMS_CACHE_VERSION || "v6";

type ChatRequest = {
  messages?: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  model?: string;
  stream?: boolean;
};

type Citation = {
  title: string;
  url: string;
};

type WebSearchSource = {
  url?: string;
  title?: string;
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

// ── Helpers ──

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

function canonicalizeClaimsUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const isIncomeDomain =
      hostname === CLAIMS_ALLOWED_DOMAIN || hostname.endsWith(`.${CLAIMS_ALLOWED_DOMAIN}`);

    // Income pages sometimes surface stale /kcassets links that 404.
    // Rewrite them to the stable kc-usercontent host + site id.
    if (isIncomeDomain && parsed.pathname.startsWith("/kcassets/")) {
      const suffix = parsed.pathname.replace(/^\/kcassets\//, "");
      if (suffix.length === 0) return url;
      return `https://${CLAIMS_KC_USERCONTENT_HOST}/${CLAIMS_KC_USERCONTENT_SITE_ID}/${suffix}`;
    }

    return url;
  } catch {
    return url;
  }
}

function detectClaimsRoute(text: string, routes: ClaimsRoute[]): ClaimsRoute | null {
  const normalized = ` ${text.toLowerCase()} `;
  let best: { route: ClaimsRoute; score: number } | null = null;

  for (const route of routes) {
    let score = 0;
    for (const keyword of route.keywords) {
      if (normalized.includes(` ${keyword.toLowerCase()} `)) {
        score += keyword.includes(" ") ? 3 : 1;
      }
    }

    if (score === 0) continue;
    if (!best || score > best.score) best = { route, score };
  }

  return best?.route || null;
}

function isCitationRelevantToRoute(citation: Citation, route: ClaimsRoute): boolean {
  try {
    const parsed = new URL(citation.url);
    const pathname = parsed.pathname.toLowerCase();
    if (route.pathPrefixes.some((prefix) => pathname.startsWith(prefix))) {
      return true;
    }

    if (pathname.endsWith(".pdf")) {
      const haystack = `${citation.title} ${citation.url}`.toLowerCase();
      return route.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
    }
    return false;
  } catch {
    return false;
  }
}

function filterCitationsByRoute(citations: Citation[], route: ClaimsRoute | null): Citation[] {
  if (!route) return citations;
  const filtered = citations.filter((citation) => isCitationRelevantToRoute(citation, route));
  return filtered.length > 0 ? filtered : citations;
}

function isAllowedClaimsUrl(url: string): boolean {
  try {
    const canonicalUrl = canonicalizeClaimsUrl(url);
    const normalizedPrefix = CLAIMS_ALLOWED_URL_PREFIX.endsWith("/")
      ? CLAIMS_ALLOWED_URL_PREFIX
      : `${CLAIMS_ALLOWED_URL_PREFIX}/`;
    if (canonicalUrl === CLAIMS_ALLOWED_URL_PREFIX || canonicalUrl.startsWith(normalizedPrefix)) {
      return true;
    }

    const parsed = new URL(canonicalUrl);
    const hostname = parsed.hostname.toLowerCase();
    const isSameDomain =
      parsed.hostname === CLAIMS_ALLOWED_DOMAIN ||
      parsed.hostname.endsWith(`.${CLAIMS_ALLOWED_DOMAIN}`);
    const isPdf = parsed.pathname.toLowerCase().endsWith(".pdf");

    if (isSameDomain && isPdf) return true;
    if (!isPdf) return false;

    return CLAIMS_ALLOWED_EXTRA_PDF_HOSTS.some(
      (allowedHost) => hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
    );
  } catch {
    return false;
  }
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const result: Citation[] = [];

  for (const citation of citations) {
    if (!citation.url) continue;
    const canonicalUrl = canonicalizeClaimsUrl(citation.url);
    if (!isAllowedClaimsUrl(canonicalUrl)) continue;

    let normalizedUrl = canonicalUrl;
    try {
      const parsed = new URL(canonicalUrl);
      parsed.hash = "";
      normalizedUrl = parsed.toString();
    } catch {
      continue;
    }

    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    result.push({
      ...citation,
      url: normalizedUrl,
    });
  }

  return result;
}

function sourceTitleFromUrl(url: string): string {
  try {
    const parsed = new URL(canonicalizeClaimsUrl(url));
    const lastPathSegment = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastPathSegment) {
      const decoded = decodeURIComponent(lastPathSegment);
      return decoded.length > 72 ? decoded.slice(0, 69) + "..." : decoded;
    }
    return parsed.hostname;
  } catch {
    return "Source";
  }
}

function extractConsultedSources(response: OpenAI.Responses.Response): WebSearchSource[] {
  const sources: WebSearchSource[] = [];

  for (const item of response.output as unknown as Array<Record<string, unknown>>) {
    if (item.type !== "web_search_call") continue;
    const action = item.action as { sources?: WebSearchSource[] } | undefined;
    const actionSources = Array.isArray(action?.sources) ? action.sources : [];
    sources.push(...actionSources);
  }

  return sources;
}

function extractCitations(response: OpenAI.Responses.Response): Citation[] {
  const annotationsCitations: Citation[] = [];
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type !== "output_text") continue;
      const annotations = part.annotations || [];
      for (const annotation of annotations) {
        const maybeCitation = annotation as OpenAI.Responses.ResponseOutputText.URLCitation;
        if (maybeCitation.type !== "url_citation") continue;
        annotationsCitations.push({
          title: maybeCitation.title || "Source",
          url: canonicalizeClaimsUrl(maybeCitation.url),
        });
      }
    }
  }

  const sourceCitations: Citation[] = extractConsultedSources(response)
    .filter((source) => typeof source.url === "string" && source.url.length > 0)
    .map((source) => ({
      title: source.title || sourceTitleFromUrl(source.url as string),
      url: canonicalizeClaimsUrl(source.url as string),
    }));

  return dedupeCitations([...annotationsCitations, ...sourceCitations]);
}

function extractConsultedSourceUrls(response: OpenAI.Responses.Response): string[] {
  const urls = new Set<string>();
  for (const source of extractConsultedSources(response)) {
    if (source.url) urls.add(source.url);
  }
  return Array.from(urls);
}

function countWebSearchCalls(response: OpenAI.Responses.Response): number {
  return response.output.filter((item) => item.type === "web_search_call").length;
}

function buildMarkdownWithUrlCitations(response: OpenAI.Responses.Response): string {
  const blocks: string[] = [];

  for (const item of response.output) {
    if (item.type !== "message") continue;

    for (const part of item.content) {
      if (part.type !== "output_text") continue;

      const partText = part.text || "";
      const rawAnnotations = Array.isArray(part.annotations) ? part.annotations : [];
      const annotations = rawAnnotations
        .map((annotation) => annotation as OpenAI.Responses.ResponseOutputText.URLCitation)
        .filter(
          (annotation) =>
            annotation.type === "url_citation" &&
            typeof annotation.url === "string" &&
            isAllowedClaimsUrl(annotation.url) &&
            typeof annotation.start_index === "number" &&
            typeof annotation.end_index === "number" &&
            annotation.end_index > annotation.start_index
        )
        .sort((a, b) => a.start_index - b.start_index);

      if (annotations.length === 0) {
        if (partText.trim().length > 0) blocks.push(partText);
        continue;
      }

      let cursor = 0;
      let linkedText = "";

      for (const annotation of annotations) {
        const start = Math.max(0, Math.min(partText.length, annotation.start_index));
        const end = Math.max(0, Math.min(partText.length, annotation.end_index));
        if (start < cursor || end <= start) continue;

        linkedText += partText.slice(cursor, start);
        const label = partText.slice(start, end).trim();

        if (label.length > 0) {
          linkedText += `[${label}](${annotation.url})`;
        } else {
          linkedText += partText.slice(start, end);
        }

        cursor = end;
      }

      linkedText += partText.slice(cursor);
      if (linkedText.trim().length > 0) blocks.push(linkedText);
    }
  }

  return blocks.join("\n");
}

function injectFormLinkFromCitations(text: string, citations: Citation[]): string {
  if (!text || citations.length === 0) return text;
  if (/\[[^\]]*claim form[^\]]*\]\([^)]+\)/i.test(text)) return text;

  const formPhraseRegex = /\b([A-Za-z][A-Za-z\s/-]{0,80}claim form)\b/i;
  const phraseMatch = text.match(formPhraseRegex);
  if (!phraseMatch?.[1]) return text;
  const phrase = phraseMatch[1];

  const genericTokens = new Set(["income", "motor", "claim", "form", "insurance"]);
  const phraseTokens = phrase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
  const specificTokens = phraseTokens.filter((token) => !genericTokens.has(token));

  const scored = citations
    .filter((citation) => /claim form|\.pdf/i.test(`${citation.title} ${citation.url}`))
    .map((citation) => {
      const haystack = `${citation.title} ${citation.url}`.toLowerCase();
      const tokenHits = phraseTokens.reduce(
        (count, token) => count + (haystack.includes(token) ? 1 : 0),
        0
      );
      const specificHits = specificTokens.reduce(
        (count, token) => count + (haystack.includes(token) ? 1 : 0),
        0
      );

      return { citation, tokenHits, specificHits };
    })
    .sort((a, b) => b.specificHits - a.specificHits || b.tokenHits - a.tokenHits);

  const best = scored[0];
  if (!best?.citation.url) return text;
  if (specificTokens.length > 0 && best.specificHits === 0) return text;
  if (best.tokenHits === 0) return text;

  return text.replace(formPhraseRegex, `[${phrase}](${best.citation.url})`);
}

function stripInlineUrls(text: string): string {
  // Preserve meaningful markdown links to income.com.sg so form names remain clickable.
  // Remove only citation-like labels such as "[income.com.sg](...)" or "[Source](...)".
  const preservedLinks: string[] = [];
  const withPlaceholders = text.replace(
    /\[([^\]]+)\]\(((?:https?:\/\/)?(?:www\.)?income\.com\.sg\/?[^\s)]*)\)/gi,
    (_match, rawLabel: string, url: string) => {
      const label = rawLabel.trim();
      if (
        label.length === 0 ||
        /income\.com\.sg/i.test(label) ||
        /^(source|link|url)$/i.test(label)
      ) {
        return label;
      }
      const token = `__INCOME_LINK_${preservedLinks.length}__`;
      preservedLinks.push(`[${label}](${url})`);
      return token;
    }
  );

  const cleaned = withPlaceholders
    // Remove "Source: income.com.sg/..." patterns (with or without scheme).
    .replace(
      /\.?\s*Source:\s*(?:https?:\/\/)?(?:www\.)?income\.com\.sg(?:\/\S*)?/gi,
      "."
    )
    // Remove "Direct PDF/Link/URL: income.com.sg/..." patterns (with or without scheme).
    .replace(
      /(?:Direct\s+)?(?:PDF|Link|URL):\s*(?:https?:\/\/)?(?:www\.)?income\.com\.sg(?:\/\S*)?/gi,
      ""
    )
    // Remove parenthetical domain citations like "(income.com.sg)" or "(www.income.com.sg/claims)".
    .replace(
      /\(\s*(?:https?:\/\/)?(?:www\.)?income\.com\.sg(?:\/[^)\s]*)?\s*\)/gi,
      ""
    )
    // Remove standalone domain citations, including broken trailing punctuation.
    .replace(/(?:https?:\/\/)?(?:www\.)?income\.com\.sg(?:\/\S*)?/gi, "")
    // Remove orphan opening parens left by partial inline citation cleanup.
    .replace(/\(\s*(?=\n|$)/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned.replace(/__INCOME_LINK_(\d+)__/g, (_token, index) => {
    const parsed = Number(index);
    return Number.isNaN(parsed) ? "" : preservedLinks[parsed] || "";
  });
}

function isCacheEntryFresh(entry: CachedResponse): boolean {
  return Date.now() < entry.expiresAtMs;
}

function shouldRunWebSearch(text: string): boolean {
  return !isSimpleSmallTalk(text);
}

// ── OpenAI Responses API helpers ──

function buildSearchRequestParams(args: {
  model: string;
  input: OpenAI.Responses.ResponseInput;
  instructions?: string;
  maxToolCalls: number;
  cacheKey: string;
  route: ClaimsRoute | null;
}): OpenAI.Responses.ResponseCreateParamsNonStreaming {
  const routePolicy = args.route
    ? `Primary claims page: ${args.route.pageUrl}. Start from this page and prioritize citations from this page, its claim sub-pages, or matching form PDFs for ${args.route.key} claims.`
    : `Primary claims index page: ${CLAIMS_ALLOWED_URL_PREFIX}.`;
  const withHint: OpenAI.Responses.ResponseInput = [
    ...args.input,
    {
      role: "developer",
      content: `Search policy: ${routePolicy} Only search within site:income.com.sg/claims and its sub-pages. Only cite URLs under ${CLAIMS_ALLOWED_URL_PREFIX} or approved Income-hosted PDF assets.`,
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
    prompt_cache_key: `claims:${args.cacheKey}`.slice(0, 64),
  } as unknown as OpenAI.Responses.ResponseCreateParamsNonStreaming;
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

  if (paramPath === "tools") {
    const tools = params.tools as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(tools) || tools.length === 0) return false;
    params.tools = [{ type: "web_search_preview" }];
    return true;
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
      const retryable =
        (err.code === "unknown_parameter" || err.code === "string_above_max_length") &&
        typeof err.param === "string";
      if (!retryable) throw error;

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
      const retryable =
        (err.code === "unknown_parameter" || err.code === "string_above_max_length") &&
        typeof err.param === "string";
      if (!retryable) throw error;

      const changed = removeUnsupportedParam(mutableParams, err.param!);
      if (!changed) throw error;
    }
  }

  throw new Error("Unable to create response stream after fallback retries");
}

function sseEvent(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── Post-processing ──

const MAX_CITATIONS = 5;

function postProcessResponse(assistantText: string, citations: Citation[]): {
  text: string;
  citations: Citation[];
} {
  const textWithFormLink = injectFormLinkFromCitations(assistantText, citations);
  const cleanText = stripInlineUrls(
    textWithFormLink ||
      "I couldn't find that on Income claims pages. Could you rephrase your question?"
  );
  return { text: cleanText, citations: citations.slice(0, MAX_CITATIONS) };
}

// ── Main handler ──

export async function POST(request: Request) {
  try {
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

    // Scope enforcement is handled by the LLM via system instructions.
    // Input/output moderation above catches harmful content.

    // ── System Instructions ──
    if (process.env.NODE_ENV === "development") clearSystemInstructionsCache();
    const systemInstructions = process.env.GUARDRAILS_ENABLED === "true"
      ? getSystemInstructions()
      : undefined;

    const inputMessages = toResponsesInput(messages);
    const modelToUse = model || DEFAULT_MODEL;
    const claimsRoutes = await listClaimsRoutesCached();
    const matchedRoute = detectClaimsRoute(latestUserText, claimsRoutes);
    const routeKey = matchedRoute?.key || "general";
    const cacheKey = `${CLAIMS_CACHE_VERSION}:${routeKey}:${normalizeQuestion(latestUserText)}`;
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

    // ── Streaming path ──
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
                    maxToolCalls: SEARCH_MAX_TOOL_CALLS,
                    cacheKey,
                    route: matchedRoute,
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

              if (completedResponse) {
                const linkedOutputText = buildMarkdownWithUrlCitations(completedResponse);
                if (linkedOutputText.trim().length > 0) {
                  assistantText = linkedOutputText;
                }
              }

              if (!assistantText && completedResponse?.output_text) {
                assistantText = completedResponse.output_text;
                send("delta", { text: assistantText });
              }

              const citations = completedResponse ? extractCitations(completedResponse) : [];
              const routeScopedCitations = filterCitationsByRoute(citations, matchedRoute);
              const outputCheck = await moderateOutput(openai, assistantText);
              const processed = postProcessResponse(assistantText, routeScopedCitations);
              const finalCitations = outputCheck.blocked ? [] : processed.citations;
              const finalText = outputCheck.blocked ? outputCheck.refusalMessage : processed.text;

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

    // ── Non-streaming path ──
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
      response = await createResponseWithFallback(
        buildSearchRequestParams({
          model: modelToUse,
          input: inputMessages,
          instructions: systemInstructions,
          maxToolCalls: SEARCH_MAX_TOOL_CALLS,
          cacheKey,
          route: matchedRoute,
        })
      );
    }

    // ── Post-process ──
    const citations = extractCitations(response);
    const routeScopedCitations = filterCitationsByRoute(citations, matchedRoute);
    const sourceUrls = extractConsultedSourceUrls(response);
    let assistantText = buildMarkdownWithUrlCitations(response) || response.output_text || "";
    const webSearchCalls = countWebSearchCalls(response);

    if (runSearch && citations.length === 0 && assistantText.trim().length === 0) {
      assistantText =
        "I couldn't find that on Income claims pages. Could you rephrase your question?";
    }

    const outputCheck = await moderateOutput(openai, assistantText);
    const processed = postProcessResponse(assistantText, routeScopedCitations);
    const finalCitations = outputCheck.blocked ? [] : processed.citations;
    const finalText = outputCheck.blocked ? outputCheck.refusalMessage : processed.text;

    if (!outputCheck.blocked && finalCitations.length > 0 && finalText.trim().length > 0) {
      claimsResponseCache.set(cacheKey, {
        content: finalText,
        citations: finalCitations,
        expiresAtMs: Date.now() + CLAIMS_CACHE_TTL_SECONDS * 1000,
      });
    }

    console.info("[api/chat] request_summary", {
      requestId,
      routeKey,
      routePage: matchedRoute?.pageUrl || null,
      webSearchCalls,
      sourceUrls,
      sourceUrlAllowlistViolations: sourceUrls.filter((url) => !isAllowedClaimsUrl(url)).length,
      citedUrls: finalCitations.map((citation) => citation.url),
    });

    const payload: ProxyResponse = {
      model: response.model,
      assistantMessage: {
        content: finalText,
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
