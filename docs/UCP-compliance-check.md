# UCP Compliance Check

This document explains how `chat-host` checks MCP server compliance with the
[Universal Commerce Protocol (UCP)](https://ucp.dev/2026-01-23/).

## Where it lives

| File | Role |
|---|---|
| `src/lib/ucp-utils.ts` | All compliance logic (tool check + profile validation) |
| `src/app/ucp/page.tsx` | `/ucp` UI — the interactive Compliance Center |

---

## Two-phase check

A server must pass **both** phases to be considered UCP Compliant.

### Phase 1 — MCP Tool Check (`checkUcpCompliance`)

After connecting to the MCP server, the tool list is compared against the five
required checkout tools defined by the UCP Checkout / MCP Binding spec:

| Tool | Required |
|---|---|
| `create_checkout` | Yes |
| `get_checkout` | Yes |
| `update_checkout` | Yes |
| `complete_checkout` | Yes |
| `cancel_checkout` | Yes |

Optional product-discovery tools are also tracked but do not affect compliance:
`list_products`, `get_product`, `recommend_products`.

A server is `isCompliant` only when **all five** required tools are present.

```ts
// src/lib/ucp-utils.ts
export function checkUcpCompliance(tools: MCPTool[]): UcpComplianceResult {
  const presentRequired = UCP_REQUIRED_TOOLS.filter(t => toolNames.has(t));
  const hasCheckout = presentRequired.length === UCP_REQUIRED_TOOLS.length;
  return { isCompliant: hasCheckout, ... };
}
```

### Phase 2 — Profile Discovery Check (`validateUcpProfile`)

The UI fetches `GET {origin}/.well-known/ucp` (the UCP Business Profile
endpoint) and validates the JSON against the spec rules:

| Check | Severity | What is validated |
|---|---|---|
| `ucp.version` present | Error | Profile must declare a UCP version string |
| `dev.ucp.shopping` MCP service entry | Error | `ucp.services["dev.ucp.shopping"]` must include an entry with `transport: "mcp"` |
| MCP `endpoint` is a valid HTTPS URL | Error | Must be present; origin should match the server origin |
| MCP `schema` is a `https://ucp.dev` URL | Error | Per UCP namespace governance: `dev.ucp.*` schemas must originate from `ucp.dev` |
| MCP `spec` is a `https://ucp.dev` URL | Error | Same rule applies to the spec URL |
| `dev.ucp.shopping.checkout` capability present | Error | Checkout capability must be declared in `ucp.capabilities` |
| Checkout capability `schema` is a `https://ucp.dev` URL | Error | |
| Checkout capability `spec` is a `https://ucp.dev` URL | Error | |
| `dev.ucp.shopping` embedded service entry | Warning | ECP (Embedded Checkout Protocol) is optional but encouraged |
| `signing_keys` array present | Warning | Required for signed webhooks / AP2 mandates |

The UI renders each error/warning inline next to the server card. A server with
any profile **errors** (even with all 5 tools) is shown as "Partial Compliance",
not "UCP Compliant".

---

## Overall compliance verdict

```
isCompliant = (all 5 checkout tools present) AND (profileCheck.errors.length === 0)
```

The `/ucp` page summarises servers into three buckets:

| Badge | Condition |
|---|---|
| **UCP Compliant** (green) | Tool check passes AND profile has 0 errors |
| **Partial Compliance** (yellow) | Connected, but tool check or profile has issues |
| **Connection Failed** (red) | Could not connect to the MCP server |

---

## Additional metadata surfaced

Beyond pass/fail, the compliance check also extracts:

- **UCP Version** — `ucpVersion` is set to `"2026-01-11"` when all 5 tools are
  present (the current spec version hardcoded in `ucp-utils.ts`).
- **Embedded Checkout (ECP)** — detected when the profile has a
  `dev.ucp.shopping` service with `transport: "embedded"`.
- **Payment Handlers** — extracted from `ucp.payment_handlers` in the profile
  via `extractPaymentHandlers()` and displayed as a list.
- **All Available Tools** — every tool exposed by the MCP server is shown as a
  badge (green = UCP required, blue = optional, grey = other).

---

## UCP Profile structure reference

A fully compliant `/.well-known/ucp` response looks like:

```json
{
  "ucp": {
    "version": "2026-01-11",
    "services": {
      "dev.ucp.shopping": [
        {
          "version": "2026-01-11",
          "transport": "mcp",
          "spec": "https://ucp.dev/specification/overview",
          "schema": "https://ucp.dev/services/shopping/mcp.openrpc.json",
          "endpoint": "https://yourserver.com/ucp/mcp"
        },
        {
          "version": "2026-01-11",
          "transport": "embedded",
          "spec": "https://ucp.dev/specification/overview",
          "schema": "https://ucp.dev/services/shopping/embedded.openrpc.json"
        }
      ]
    },
    "capabilities": {
      "dev.ucp.shopping.checkout": [
        {
          "version": "2026-01-11",
          "spec": "https://ucp.dev/specification/checkout",
          "schema": "https://ucp.dev/schemas/shopping/checkout.json"
        }
      ]
    },
    "payment_handlers": { ... }
  },
  "signing_keys": [ ... ]
}
```

---

## How to use the Compliance Center

1. Navigate to `/ucp` in the running app.
2. Paste an MCP server URL and click **Add & Scan**.
   - The server URL is persisted in `localStorage` under `mcpSavedServers`.
3. The page connects to the MCP server, fetches its tool list, then fetches its
   `/.well-known/ucp` profile.
4. Results are shown immediately; click **Rescan All** to re-run all checks.

---

## Relevant UCP spec sections

| Topic | Spec location |
|---|---|
| Profile structure & discovery | `ucp/docs/specification/overview.md` → "Profile Structure" |
| MCP transport binding | `ucp/docs/specification/checkout-mcp.md` |
| Namespace governance & spec URL rules | `ucp/docs/specification/overview.md` → "Namespace Governance" |
| Checkout tool definitions | `ucp/docs/specification/checkout.md` |
| Payment handlers | `ucp/docs/specification/overview.md` → "Payment Architecture" |
