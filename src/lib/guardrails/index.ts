import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";

const REFUSAL_MESSAGE =
  "I can't help with that. I can assist you with bill payments, account inquiries, and billing support.";

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
