import OpenAI from "openai";
import { readFileSync } from "fs";
import { join } from "path";

const REFUSAL_MESSAGE =
  "I can only help with Income claims questions and steps from the claims pages.";

const CLAIMS_SCOPE_REFUSAL_MESSAGE =
  "I can only help with Income claims questions and steps from the claims pages.";

const SCOPE_CLASSIFIER_MODEL = process.env.SCOPE_CLASSIFIER_MODEL || "gpt-5-mini";

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
  reason: string;
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

const SMALL_TALK_REGEX =
  /^(hi|hello|hey|yo|sup|howdy|good (morning|afternoon|evening)|thanks?|thank you)[!.?]*$/i;

export function isSimpleSmallTalk(text: string): boolean {
  return SMALL_TALK_REGEX.test(text.trim());
}

export function getClaimsScopeRefusalMessage(): string {
  return CLAIMS_SCOPE_REFUSAL_MESSAGE;
}

/**
 * Use a fast LLM call to classify whether the user's message (in conversation context)
 * is related to Income insurance claims.
 *
 * Fail-open: if the classifier errors, allow the message through and let the main
 * model + system instructions handle scope enforcement.
 */
export async function assessClaimsScope(
  openai: OpenAI,
  latestUserText: string,
  conversationSummary: string
): Promise<ClaimsScopeResult> {
  if (!latestUserText.trim()) {
    return { inScope: false, reason: "empty" };
  }

  if (isSimpleSmallTalk(latestUserText)) {
    return { inScope: true, reason: "small-talk" };
  }

  if (!isGuardrailEnabled("GUARDRAILS_SCOPE_CHECK")) {
    return { inScope: true, reason: "scope-check-disabled" };
  }

  try {
    const response = await openai.responses.create({
      model: SCOPE_CLASSIFIER_MODEL,
      instructions: `You are a scope classifier for an insurance claims assistant. Decide if the user's message could relate to making an insurance claim.

IN-SCOPE (return true) — any of these:
- Describing an incident that could lead to a claim: car accident, stolen vehicle, injury, house damage, flood, fire, hospitalization, lost baggage, flight delay, work injury, etc.
- Asking about claim processes, forms, documents, deadlines, or next steps
- Asking about reporting an accident or incident
- Asking what to do after something bad happened (accident, theft, injury, damage)
- Follow-up messages in an ongoing claims conversation (e.g. "personal", "yes", "what documents", "motor")
- Mentioning insurance, policy, or Income in a claims context

OUT-OF-SCOPE (return false) — clearly unrelated:
- Buying new policies or comparing plans
- Questions about weather, sports, cooking, coding, etc.
- General chitchat with no connection to insurance incidents or claims

When in doubt, return true. It's better to let a borderline message through than to block a real claims question.

Respond with JSON: {"in_scope": true/false, "reason": "brief explanation"}`,
      input: [
        {
          role: "user",
          content: conversationSummary
            ? `Conversation so far:\n${conversationSummary}\n\nLatest message: "${latestUserText}"\n\nRespond in JSON.`
            : `Message: "${latestUserText}"\n\nRespond in JSON.`,
        },
      ],
      text: {
        format: {
          type: "json_object",
        },
      },
      max_output_tokens: 80,
    } as OpenAI.Responses.ResponseCreateParamsNonStreaming);

    const parsed = JSON.parse(response.output_text || "{}") as {
      in_scope?: boolean;
      reason?: string;
    };

    return {
      inScope: parsed.in_scope === true,
      reason: parsed.reason || "llm-classified",
    };
  } catch (err) {
    console.error("[guardrails] Scope classifier error:", err);
    // Fail-open: let the main model handle it
    return { inScope: true, reason: "classifier-error-fail-open" };
  }
}
