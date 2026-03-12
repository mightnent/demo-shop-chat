# PRD: Claims-Only Agent Search (`agent-search`)

## 1. Executive Summary

### Problem Statement
The current chat-host product is designed for agentic commerce with MCP/UCP tool orchestration, but the insurance use case needs a narrower assistant focused on motor claims guidance. Building a full RAG/indexing pipeline is unnecessary because the needed information already exists on `https://www.income.com.sg/claims` and its claim-specific subpages.

### Proposed Solution
Replace commerce-focused behavior with a claims-only search and retrieval assistant that uses OpenAI Responses API + web search tool, constrained to Income claims pages. Add deterministic routing, cache-first retrieval, and strict guardrails so the model only searches when needed and only answers claims-related questions.

### Success Criteria
- `>= 95%` of answered claims queries include at least one clickable citation from allowed URLs under `https://www.income.com.sg/claims`.
- `100%` of cited URLs pass allowlist validation (`https://www.income.com.sg/claims` prefix).
- Tool-call efficiency: average web search calls per user turn `<= 0.6` after warm cache.
- Latency targets: P95 non-search turns `<= 2.5s`; P95 search turns `<= 8s`.
- Task success on seeded scenarios (accident immediate steps, claim process next steps, claim type info, stolen vehicle + required form/PDF) `>= 90%`.

## 2. User Experience & Functionality

### User Personas
- Policyholder in distress: needs immediate, clear post-accident actions.
- Policyholder filing claim: needs step-by-step process and required documents/forms.
- Policyholder with specific incident type (e.g., theft): needs claim-type-specific instructions and forms.
- 24/7 self-service user: expects quick answers without waiting for manual support.

### User Stories
- As a motor policyholder after an accident, I want immediate actionable steps so I can reduce risk and proceed correctly.
- As a claimant, I want the next steps in sequence so I can complete the claim process without missing requirements.
- As a user with a specific incident (e.g., vehicle stolen), I want claim-type-specific guidance and exact forms (including PDFs) so I can submit correctly.
- As a user outside business hours, I want reliable self-service support with citations so I can trust the answer.

### Acceptance Criteria
- For “what should I do after I get into accident”, assistant returns ordered immediate actions and cites relevant claims page URLs.
- For “what if my vehicle is stolen”, assistant returns theft-claim workflow and cites theft-specific claims page URL(s).
- For “what form do I fill in if my vehicle is stolen”, assistant includes the exact form name and direct PDF link if available on allowed pages.
- Assistant refuses or redirects out-of-scope questions with a single concise claims-scope refusal.
- Assistant does not cite or recommend content from non-allowlisted domains/pages.
- If first-pass targeted retrieval is insufficient, assistant performs fallback deep search before replying “not found”.

### Non-Goals
- No vector database, embeddings pipeline, ingestion jobs, or RAG chunk-store implementation.
- No broad insurance advisory outside claims content available on allowed pages.
- No multi-domain crawling or general web browsing beyond the claims allowlist.
- No claim submission transaction flow (form submission backend) in this phase.

## 3. AI System Requirements

### Tool Requirements
- Primary model API: OpenAI Responses API.
- Search tool: `web_search` with domain filtering configured per OpenAI docs (`filters` allowlist; domain format without protocol).
- Enforce path-level guardrail in app code: allow only URLs with prefix `https://www.income.com.sg/claims` (domain filters alone are not path-scoped).
- Request `web_search_call.action.sources` in `include` to collect all consulted sources for compliance checks.
- Use `tool_choice: auto` with policy gating, not always-on tool usage.
- Set bounded `max_tool_calls` for cost control.

### Evaluation Strategy
- Build a claims eval set (minimum 80 prompts) across:
  - Accident immediate actions
  - Claim process next steps
  - Claim type differentiation (collision, theft, etc.)
  - Form/PDF retrieval queries
  - Out-of-scope rejection cases
- Score dimensions:
  - Groundedness/citation correctness
  - URL allowlist compliance
  - Task completion correctness
  - Tool-call count per turn
  - Response latency and token/tool cost
- Weekly regression run before release cut; block deployment if allowlist compliance < 100%.

## 4. Technical Specifications

### Architecture Overview
1. User sends message to `/api/chat`.
2. Input guardrail pipeline runs:
   - Moderation (existing).
   - New claims scope gate (hard allow/deny for claims intents).
3. Retrieval orchestrator decides path:
   - Cache hit path: answer from cached normalized Q&A + source metadata.
   - First-pass targeted path: intent classifier maps to claim subtype and preferred subpage(s), then constrained search/fetch.
   - Fallback deep search path: broader query within allowlist, still path-validated.
4. Model composes response with citations.
5. Output guardrail pipeline verifies:
   - Claims scope compliance.
   - All citations pass allowlist/path rules.
6. Return assistant message + citations to UI.

### Integration Points
- `src/app/api/chat/route.ts`
  - Replace commerce greeting/content assumptions.
  - Add scope gate and retrieval policy orchestration before model call.
  - Add citation/source validation post-response.
- `src/lib/guardrails/system-instructions.md`
  - Replace shopping-only prompt with claims-only policy and refusal behavior.
- `src/lib/guardrails/index.ts`
  - Update refusal copy to claims scope.
  - Add scope-check helper (rule-based + keyword/intent patterns).
- `src/components/chat/chat-container.tsx`
  - Remove UCP-specific system prompt/tool argument injection from runtime flow.
  - Keep frontend chat UX while switching to claims assistant semantics.
- Config/env
  - `CLAIMS_ALLOWED_URL_PREFIX=https://www.income.com.sg/claims`
  - `CLAIMS_ALLOWED_DOMAIN=income.com.sg`
  - `SEARCH_MAX_TOOL_CALLS=2`
  - `CLAIMS_CACHE_TTL_SECONDS=900`

### Security & Privacy
- Restrict external retrieval to allowlisted claims URLs only.
- Do not collect unnecessary PII; do not ask for NRIC, full policy numbers, or payment info.
- Log request IDs, tool calls, cited URLs, and scope-gate decisions for auditability.
- Keep moderation fail-closed for unsafe content.
- Enforce refusal for legal/financial advice beyond factual claims process content on allowed pages.

## 5. Risks & Roadmap

### Phased Rollout
- MVP (Phase 1)
  - Claims-only prompt and refusal behavior.
  - Scope gate + strict URL allowlist enforcement.
  - Basic web search integration + citation rendering.
  - Seeded eval suite and monitoring dashboard.
- v1.1 (Phase 2)
  - Intent-to-subpage routing for motor claim types.
  - Cache layer (query normalization + response/source cache).
  - Fallback deep search strategy with bounded tool calls.
- v2.0 (Phase 3)
  - Adaptive retrieval policy tuning based on eval telemetry.
  - Richer answer templates (step lists, required-doc checklist, form highlights).
  - Admin analytics for unresolved questions and content gaps.

### Technical Risks
- Path-level restriction gap: OpenAI web-search filters are domain-based; mitigation is strict post-filter on final URLs by prefix.
- Website structure drift: claims subpages/PDF links may change; mitigation is health-check crawler and stale-link alerts.
- Over-search cost spikes: mitigation is cache-first policy, intent routing, max tool calls, and latency/cost budgets.
- Hallucinated forms or steps: mitigation is mandatory citations + “unknown when uncited” response policy.
- Scope false positives/negatives: mitigation is iterative classifier tuning with reviewed out-of-scope dataset.

## Assumptions / TBD
- Initial release targets motor claims questions only (not life/health/travel claims). -> i dont think it matters. its just what the user search for. 
- UI will display citation links directly in the assistant response and keep them clickable. -> yes, i want it to show citation badges, just like how chatgpt does it. 
- Existing auth and moderation architecture remains unchanged for this feature pivot. -> yes

## OpenAI Docs References
- Web search guide (domain filtering, sources, limitations): https://platform.openai.com/docs/guides/tools-web-search
- Responses API reference (`max_tool_calls`, `prompt_cache_key`, `include` sources fields): https://developers.openai.com/api/reference/resources/responses/methods/create/
