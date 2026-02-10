# Guardrails (Simple)

This is the lowest-effort guardrail set that still works in practice for the chat-host proxy.

Target integration points (current repo):

- `src/app/api/chat/route.ts` (main gate)
- Your tool runner endpoints (where tool calls actually execute)

## Implementation Status

| # | Layer | Status |
|---|-------|--------|
| 1 | Input Moderation Gate | ✅ Implemented |
| 2 | Output Moderation Gate | ✅ Implemented |
| 3 | System/Developer Instruction | ✅ Implemented |
| 4 | Scope Gate | ⬜ Not yet implemented |
| 5 | Tool Allowlist | ⬜ Not yet implemented |
| 6 | Domain Allowlist (external search) | ⬜ Not yet implemented |
| 7 | Rate Limiting | ⬜ Not yet implemented |

**Key files:**

- `src/lib/guardrails/index.ts` — moderation functions & system instruction loader
- `src/lib/guardrails/system-instructions.md` — editable system prompt (change this to reshape agent behavior)
- `.env` / `.env.example` — `GUARDRAILS_*` flags

## Goals

- Reject explicit/vulgar/hateful/self-harm content using OpenAI Moderation.
- Only allow on-topic conversation and permitted tool calls.
- Prepare for future external search tools (e.g. Exa) with strict domain allowlists.
- Add rate limiting to reduce abuse and runaway costs.

## The “Easy” Guardrail Layers (Do These First)

### 1) Input Moderation Gate (before calling the model) — ✅ Implemented

Do:

- Run `openai.moderations.create({ model: "omni-moderation-latest", input: latestUserText })`.
- If `flagged === true`: return a neutral refusal response and stop.

Notes:

- Moderate only the latest user turn for latency (good enough for Phase 1).
- Prefer "fail-closed" for demos (if moderation fails, block).

> **Impl:** `moderateInput()` in `src/lib/guardrails/index.ts`, called in `route.ts` before the model call. Controlled by `GUARDRAILS_INPUT_MODERATION` env var.

### 2) Output Moderation Gate (before returning assistant text) — ✅ Implemented

Do:

- After `responses.create`, run moderation on `response.output_text`.
- If flagged: replace with a safe fallback answer (and do not return tool calls).

This prevents accidental policy-violating content even if your system prompt is bypassed.

> **Impl:** `moderateOutput()` in `src/lib/guardrails/index.ts`, called in `route.ts` after the model response. If flagged, tool calls are also stripped. Controlled by `GUARDRAILS_OUTPUT_MODERATION` env var.

### 3) System/Developer Instruction (model behavior shaping) — ✅ Implemented

Do:

- Add a single "guardrail instruction block" via `instructions` (Responses API) or as a top-of-input `developer` message.

The instruction text is loaded from an **editable markdown file** so it can be changed without code changes:

- `src/lib/guardrails/system-instructions.md`

In development mode, the file is re-read on every request (no restart needed). In production it is cached.

Important:

- Prompting is not sufficient by itself. Treat it as "reduce drift," not "enforcement."

> **Impl:** `getSystemInstructions()` in `src/lib/guardrails/index.ts`, injected as `instructions` param in the Responses API call. Active when `GUARDRAILS_ENABLED=true`.

### 4) Scope Gate (hard enforcement) — ⬜ Not yet implemented

Do:

- Implement `scopeCheck(latestUserText)` in the server route *before* the model call.
- If out-of-scope: refuse immediately.

Start simple (rule-based):

- Allow if the request looks like: product search, “compare X vs Y”, pricing, availability, reviews, alternatives, “find me”, “recommend”, “buy”, “checkout”, “shipping”, “return”.
- Deny if it’s a generic how-to, schoolwork, coding help, cooking, medical/legal, etc.

Example: “how to make bread” => out-of-scope => refuse.

Optional later (better recall, more work):

- Add a tiny classifier step (either your own small model call or a deterministic ruleset + allowlist).
- Keep the result as a boolean + reason code (for audit/metrics).

### 5) Tool Allowlist + "Tool Choice Off by Default" — ⬜ Not yet implemented

Do:

- Maintain a server-side allowlist of tool names.
- Strip any client-provided tools not in the allowlist.
- Default `tool_choice` to `"none"` unless the scope gate says the user is asking for an allowed tool-driven action.

Rationale:

- This is usually the biggest “risk reduction per LOC.”
- Never rely on the model to “choose not to call tools.”

### 6) Domain Allowlist for External Search Tools (e.g. Exa) — ⬜ Not yet implemented

When you integrate an external search tool:

- Enforce domain allowlists in the tool implementation (server-side), not via prompt.
- Ignore/override any model-supplied domains if they are not in the allowlist.

Concrete pattern:

- Tool inputs: `{ query: string, domains?: string[] }`
- Server behavior:
  - If `domains` is missing: set it to your default allowlist.
  - If `domains` present: intersect with allowlist; if empty => refuse tool call.

Keep allowlists in env/config:

- `EXA_ALLOWED_DOMAINS=example.com,brand.com,retailer.com`

### 7) Rate Limiting (per user, plus a backstop per IP) — ⬜ Not yet implemented

Do:

- Apply rate limiting at the start of `/api/chat`:
  - Per authenticated user ID (best).
  - If unauthenticated: per IP.

Two implementation tiers:

1. Demo/simple: in-memory token bucket (fast, minimal deps).
  - Works on a single Node process.
  - Not reliable across multi-instance/serverless deployments.

2. Production: Redis-backed limiter.
  - Consistent across instances.
  - Recommended once you deploy beyond a single process.

Suggested starting limits (tune later):

- 30 requests / minute / user for chat.
- 10 tool executions / minute / user for expensive tools.
- A smaller burst limit (e.g. 5 in 10 seconds) to stop spam.

User-facing response on limit:

- HTTP 429 + `{ error: "RATE_LIMITED", retryAfterMs }`

## Refusal Copy (Use One, Keep It Boring)

Use consistent, neutral copy:

> I can’t help with that. I can help with product discovery, comparisons, and checkout support.

Do not:

- Explain which policy category triggered.
- Reveal your allowlist or internal filters.

## Minimal Config (Environment Flags)

Currently active (set in `.env`):

- `GUARDRAILS_ENABLED=true` — master switch
- `GUARDRAILS_INPUT_MODERATION=true` — toggle input moderation
- `GUARDRAILS_OUTPUT_MODERATION=true` — toggle output moderation
- `GUARDRAILS_FAIL_CLOSED=true` — block on moderation API errors

Not yet used (for future layers):

- `GUARDRAILS_SCOPE_ENABLED=true`
- `GUARDRAILS_RATE_LIMIT_ENABLED=true`
- `GUARDRAILS_RPM_PER_USER=30`
- `GUARDRAILS_RPM_PER_IP=10`

## Implementation Checklist (Order Matters)

1. ✅ Add input moderation gate (block flagged).
2. ⬜ Add scope gate (block out-of-scope).
3. ✅ Add `instructions` block (reduce drift).
4. ⬜ Tool allowlist + tool_choice default `"none"`.
5. ✅ Add output moderation gate (block flagged).
6. ⬜ Add rate limiting.
7. ⬜ Add domain allowlists inside external tools.

## Test Cases (Quick Manual)

Should be blocked:

- Explicit sexual content.
- Hate/harassment/slurs.
- “How to make bread.”
- “Write my resume.”

Should be allowed:

- “Find me a waterproof hiking jacket under $150.”
- “Compare AirPods Pro vs Sony WF-1000XM5.”
- “What’s the return policy for X?” (if your demo supports it; otherwise refuse as out-of-scope).

Should be rate-limited:

- Rapid-fire repeated requests from the same user.

