import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";

const REFUSAL_MESSAGE =
  "I can only help with Income motor claims questions and steps from the claims pages.";

const CLAIMS_SCOPE_REFUSAL_MESSAGE =
  "I can only help with Income motor claims questions and steps from the claims pages.";

let cachedSystemInstructions: string | null = null;

/**
 * Load system instructions from the editable markdown file.
 * Cached after first read (restart server to pick up changes).
 */
export function getSystemInstructions(): string {
  if (cachedSystemInstructions) return cachedSystemInstructions;

  const filePath = join(
    process.cwd(),
    "src",
    "lib",
    "guardrails",
    "system-instructions.md"
  );
  cachedSystemInstructions = readFileSync(filePath, "utf-8").trim();
  return cachedSystemInstructions;
}

/**
 * In dev, allow hot-reloading the system instructions without restart.
 */
export function clearSystemInstructionsCache(): void {
  cachedSystemInstructions = null;
}

/**
 * Run OpenAI Moderation on text. Returns { flagged, categories } or throws.
 */
async function moderate(
  openai: OpenAI,
  text: string
): Promise<{ flagged: boolean; categories: Record<string, boolean> }> {
  const result = await openai.moderations.create({
    model: "omni-moderation-latest",
    input: text,
  });
  const first = result.results[0];
  return {
    flagged: first.flagged,
    categories: first.categories as unknown as Record<string, boolean>,
  };
}

export type ModerationResult =
  | { blocked: false }
  | { blocked: true; refusalMessage: string };

export type ClaimsScopeResult = {
  inScope: boolean;
  normalizedText: string;
  matchedKeywords: string[];
};

/**
 * Input Moderation Gate — run before calling the model.
 * Moderates only the latest user message text.
 * Fail-closed: if moderation API errors, block the request.
 */
export async function moderateInput(
  openai: OpenAI,
  latestUserText: string
): Promise<ModerationResult> {
  if (!isGuardrailEnabled("GUARDRAILS_INPUT_MODERATION")) {
    return { blocked: false };
  }

  if (!latestUserText.trim()) {
    return { blocked: false };
  }

  try {
    const { flagged } = await moderate(openai, latestUserText);
    if (flagged) {
      return { blocked: true, refusalMessage: REFUSAL_MESSAGE };
    }
    return { blocked: false };
  } catch (err) {
    console.error("[guardrails] Input moderation API error:", err);
    if (isFailClosed()) {
      return { blocked: true, refusalMessage: REFUSAL_MESSAGE };
    }
    return { blocked: false };
  }
}

/**
 * Output Moderation Gate — run before returning assistant text.
 * If flagged, replaces the assistant content with a safe refusal.
 */
export async function moderateOutput(
  openai: OpenAI,
  assistantText: string
): Promise<ModerationResult> {
  if (!isGuardrailEnabled("GUARDRAILS_OUTPUT_MODERATION")) {
    return { blocked: false };
  }

  if (!assistantText.trim()) {
    return { blocked: false };
  }

  try {
    const { flagged } = await moderate(openai, assistantText);
    if (flagged) {
      return { blocked: true, refusalMessage: REFUSAL_MESSAGE };
    }
    return { blocked: false };
  } catch (err) {
    console.error("[guardrails] Output moderation API error:", err);
    if (isFailClosed()) {
      return { blocked: true, refusalMessage: REFUSAL_MESSAGE };
    }
    return { blocked: false };
  }
}

// ── helpers ──

function isGuardrailEnabled(envKey: string): boolean {
  const master = process.env.GUARDRAILS_ENABLED;
  if (master !== "true") return false;
  return process.env[envKey] !== "false"; // enabled by default when master is on
}

function isFailClosed(): boolean {
  return process.env.GUARDRAILS_FAIL_CLOSED !== "false"; // default true
}

const CLAIMS_KEYWORDS = [
  "claim",
  "claims",
  "accident",
  "stolen",
  "theft",
  "vehicle",
  "car",
  "motor",
  "policy",
  "report",
  "form",
  "document",
  "workshop",
  "repair",
  "tow",
  "own damage",
  "third party",
  "windscreen",
  "police report",
  "income",
];

const SMALL_TALK_REGEX =
  /^(hi|hello|hey|yo|sup|howdy|good (morning|afternoon|evening)|thanks?|thank you)[!.?]*$/i;

export function isSimpleSmallTalk(text: string): boolean {
  return SMALL_TALK_REGEX.test(text.trim());
}

export function getClaimsScopeRefusalMessage(): string {
  return CLAIMS_SCOPE_REFUSAL_MESSAGE;
}

export function assessClaimsScope(text: string): ClaimsScopeResult {
  const normalizedText = text.trim().toLowerCase();
  if (!normalizedText) {
    return { inScope: false, normalizedText, matchedKeywords: [] };
  }

  if (isSimpleSmallTalk(normalizedText)) {
    return { inScope: true, normalizedText, matchedKeywords: ["small-talk"] };
  }

  const matchedKeywords = CLAIMS_KEYWORDS.filter((keyword) => normalizedText.includes(keyword));
  const inScope = matchedKeywords.length > 0;

  return { inScope, normalizedText, matchedKeywords };
}
