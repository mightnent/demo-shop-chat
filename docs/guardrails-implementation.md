# Guardrails Implementation (Next.js Chat Host)

## Goal

Add practical guardrails to the chat host so responses stay:

- safe (no vulgar/explicit/harmful content),
- in demo scope (commerce discovery + configured MCP tools),
- observable (auditable enough to debug abuse and policy misses).

This write-up is designed for the current `chat-host` codebase, especially:

- `/Users/mikesun/Documents/projects/agentic-commerce-discovery/chat-host/src/app/api/chat/route.ts`
- `/Users/mikesun/Documents/projects/agentic-commerce-discovery/chat-host/src/app/api/messages/route.ts`
- `/Users/mikesun/Documents/projects/agentic-commerce-discovery/chat-host/src/lib/services/audit.ts`

## Recommended Guardrail Layers

Do not rely on prompt-only controls. Use four layers:

1. Input safety gate (Moderation API) before model call.
2. Scope gate (allow only in-domain demo tasks/tool usage).
3. Model behavior constraints (developer instructions + tool policy).
4. Output safety gate before returning assistant text.

## Reference Flow

1. User message arrives at `/api/chat`.
2. Authenticate user (`requireAuth`) and resolve `safety_identifier`.
3. Run input moderation (`omni-moderation-latest`) on latest user text.
4. Run scope classifier/rules on latest user text.
5. If blocked: return safe refusal payload.
6. If allowed: call `responses.create` with strict instructions and constrained tools.
7. Run output moderation on `response.output_text`.
8. If output blocked: replace with safe fallback response.
9. Emit minimal audit/metrics event (without logging raw sensitive text).

## Phase 1 (Minimum Viable Guardrails)

### 1) Add an input moderation step in `/api/chat`

- Moderate only the latest user turn for latency.
- Block on `flagged === true` initially.
- Return a user-facing, neutral refusal message.

Example policy behavior:

- Explicit sexual content -> blocked.
- Harassment/hate/slurs -> blocked.
- Self-harm instructions -> blocked.

### 2) Add output moderation step

- Moderate generated `output_text` before sending JSON response.
- If flagged, override content with a safe fallback and no tool calls.

### 3) Add explicit demo-scope instruction block

In the `responses.create` call, set `instructions` to include:

- scope: commerce discovery demo only,
- refuse out-of-scope tasks,
- never provide explicit/vulgar sexual content,
- never produce hateful/harassing content.

### 4) Send `safety_identifier`

Use a stable hashed ID per authenticated user:

- deterministic hash of internal user ID or email,
- never raw PII.

Pass as `safety_identifier` to `responses.create`.

## Phase 2 (Scope and Tool Guardrails)

### 1) Add `scopeCheck()` in server route

Implement a lightweight gate before LLM call:

- allow intent families: product lookup, comparison, checkout guidance, MCP-supported actions.
- block unrelated categories: roleplay erotica, extremist content, exploit instructions, random non-demo requests.

Start with rule-based checks; move to classifier-only if needed.

### 2) Add tool allowlist policy

Before forwarding `tools`:

- keep only tool names on a server-side allowlist,
- drop unknown tools,
- optionally force `tool_choice = "none"` for risky prompts.

### 3) Add high-risk confirmation pattern (if write actions exist)

For destructive or external side effects:

- return a confirmation-needed response,
- require explicit user confirmation before tool execution.

## Phase 3 (Observability and Abuse Controls)

### 1) Guardrail telemetry

Track counters and rate by:

- `guardrail.input_blocked`
- `guardrail.output_blocked`
- `guardrail.scope_blocked`
- `guardrail.tool_blocked`

### 2) Audit integration

Current project policy limits high-volume audit writes. Keep that principle:

- log only compact, structured guardrail events,
- avoid raw full prompt/response storage by default,
- include category labels and request IDs.

Suggested event types to enable (if desired):

- `system.error` for moderation API failures,
- `chat.message_received`/`chat.message_sent` only for block summaries, not every turn.

### 3) Abuse throttling

When repeated blocked requests occur for one identifier:

- apply short cooldown,
- then temporary mute/ban in host app.

## Concrete Changes by File

### `/src/app/api/chat/route.ts`

Add:

- `moderateText(text: string)` helper,
- `extractLatestUserText(messages)` helper,
- `scopeCheck(text)` helper,
- `buildGuardrailInstructions()` helper,
- `hashSafetyIdentifier(userId)` helper.

Update flow:

- run input moderation + scope gate before `responses.create`,
- pass `instructions` and `safety_identifier`,
- run output moderation on `response.output_text`.

### `/src/lib/services/audit.ts`

Optional update:

- include compact guardrail payload schema support:
  - `{ stage, blocked, categories, reasonCode }`

Keep DB-write-failure-safe behavior unchanged.

### `/README.md`

Add a short section:

- “Guardrails: moderation + scope + safe fallback”
- env vars for guardrail toggles and thresholds.

## Suggested Environment Flags

Add to `.env.example`:

- `GUARDRAILS_ENABLED=true`
- `GUARDRAILS_SCOPE_ENABLED=true`
- `GUARDRAILS_OUTPUT_MODERATION=true`
- `GUARDRAILS_FAIL_OPEN=false` (if moderation API fails, block by default for demo safety)

## Safe Refusal Copy (Demo)

Use consistent user-facing copy:

> I can’t help with that request. I can help with product discovery, comparisons, and checkout support in this demo.

## Testing Checklist

Run these before rollout:

1. Explicit sexual prompt is blocked before model call.
2. Harassment/hate prompt is blocked before model call.
3. Out-of-scope request is blocked with scope refusal.
4. Normal commerce query passes and returns useful answer.
5. Tool calls still work for in-scope requests.
6. Guardrail telemetry counters increment correctly.
7. Moderation API outage path follows `GUARDRAILS_FAIL_OPEN` policy.

## Rollout Plan

1. Ship Phase 1 behind env flags.
2. Test in staging with adversarial prompt set.
3. Enable Phase 2 allowlist + scope checks.
4. Add Phase 3 throttling after observing real traffic.

## Notes

- Prompt-only controls are not sufficient.
- Moderation category scores can drift over model upgrades; if custom thresholds are added later, recalibrate periodically.
- Keep guardrail decisions server-side in `/api/chat` to avoid client bypass.
