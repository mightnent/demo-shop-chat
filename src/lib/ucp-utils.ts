import type { ToolResult, MCPTool } from "./mcp-client";

export const UCP_CHECKOUT_TOOLS = new Set([
  "create_checkout",
  "get_checkout",
  "update_checkout",
  "complete_checkout",
  "cancel_checkout",
]);

export const UCP_REQUIRED_TOOLS = [
  "create_checkout",
  "get_checkout",
  "update_checkout",
  "complete_checkout",
  "cancel_checkout",
];

export const UCP_OPTIONAL_TOOLS = [
  "list_products",
  "get_product",
  "recommend_products",
];

export interface UcpProfileCheckResult {
  version?: string;
  errors: string[];
  warnings: string[];
  hasMcpService: boolean;
  hasCheckoutCapability: boolean;
}

export interface UcpComplianceResult {
  isCompliant: boolean;
  hasCheckout: boolean;
  missingRequired: string[];
  presentRequired: string[];
  presentOptional: string[];
  paymentHandlers: string[];
  ucpVersion?: string;
}

export function checkUcpCompliance(tools: MCPTool[]): UcpComplianceResult {
  const toolNames = new Set(tools.map((t) => t.name));

  const presentRequired = UCP_REQUIRED_TOOLS.filter((t) => toolNames.has(t));
  const missingRequired = UCP_REQUIRED_TOOLS.filter((t) => !toolNames.has(t));
  const presentOptional = UCP_OPTIONAL_TOOLS.filter((t) => toolNames.has(t));

  const hasCheckout = presentRequired.length === UCP_REQUIRED_TOOLS.length;
  const isCompliant = hasCheckout;

  return {
    isCompliant,
    hasCheckout,
    missingRequired,
    presentRequired,
    presentOptional,
    paymentHandlers: [], // Will be populated from server response
    ucpVersion: hasCheckout ? "2026-01-11" : undefined,
  };
}

function isUcpDevUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).origin === "https://ucp.dev";
  } catch {
    return false;
  }
}

export function validateUcpProfile(
  profile: Record<string, unknown>,
  serverUrl: string
): UcpProfileCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const ucp = (profile.ucp || {}) as Record<string, unknown>;
  const version = typeof ucp.version === "string" ? ucp.version : undefined;
  if (!version) {
    errors.push("Missing ucp.version");
  }

  const services = (ucp.services || {}) as Record<string, unknown>;
  const shoppingServices = Array.isArray(services["dev.ucp.shopping"])
    ? (services["dev.ucp.shopping"] as Array<Record<string, unknown>>)
    : [];

  const serverOrigin = (() => {
    try {
      return new URL(serverUrl).origin;
    } catch {
      return "";
    }
  })();

  const mcpService = shoppingServices.find((svc) => svc.transport === "mcp");
  const hasMcpService = Boolean(mcpService);
  if (!mcpService) {
    errors.push("Missing dev.ucp.shopping MCP service entry");
  } else {
    const endpoint = typeof mcpService.endpoint === "string" ? mcpService.endpoint : undefined;
    const schema = typeof mcpService.schema === "string" ? mcpService.schema : undefined;
    const spec = typeof mcpService.spec === "string" ? mcpService.spec : undefined;

    if (!endpoint) {
      errors.push("MCP service missing endpoint");
    } else if (serverOrigin) {
      try {
        const endpointOrigin = new URL(endpoint).origin;
        if (endpointOrigin !== serverOrigin) {
          warnings.push("MCP endpoint origin does not match server origin");
        }
      } catch {
        errors.push("Invalid MCP endpoint URL");
      }
    }

    if (!schema || !isUcpDevUrl(schema)) {
      errors.push("MCP service schema must be a https://ucp.dev URL");
    }
    if (!spec || !isUcpDevUrl(spec)) {
      errors.push("MCP service spec must be a https://ucp.dev URL");
    }
  }

  const capabilities = (ucp.capabilities || {}) as Record<string, unknown>;
  const checkoutCaps = Array.isArray(capabilities["dev.ucp.shopping.checkout"])
    ? (capabilities["dev.ucp.shopping.checkout"] as Array<Record<string, unknown>>)
    : [];

  const checkoutCap = checkoutCaps[0];
  const hasCheckoutCapability = Boolean(checkoutCap);
  if (!checkoutCap) {
    errors.push("Missing dev.ucp.shopping.checkout capability");
  } else {
    const schema = typeof checkoutCap.schema === "string" ? checkoutCap.schema : undefined;
    const spec = typeof checkoutCap.spec === "string" ? checkoutCap.spec : undefined;
    if (!schema || !isUcpDevUrl(schema)) {
      errors.push("Checkout capability schema must be a https://ucp.dev URL");
    }
    if (!spec || !isUcpDevUrl(spec)) {
      errors.push("Checkout capability spec must be a https://ucp.dev URL");
    }
  }

  if (!Array.isArray(profile.signing_keys)) {
    warnings.push("Missing signing_keys in profile (required for signed webhooks)");
  }

  return {
    version,
    errors,
    warnings,
    hasMcpService,
    hasCheckoutCapability,
  };
}

export interface UcpCheckoutData {
  ucp: {
    version: string;
    capabilities: Record<string, Array<{ version: string }>>;
    payment_handlers?: Record<
      string,
      Array<{ id: string; version: string; config?: unknown }>
    >;
  };
  id: string;
  status: string;
  buyer: {
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  line_items: Array<{
    id: string;
    item: { id: string; title?: string; price?: number };
    quantity: number;
    totals: Array<{ type: string; amount: number; display_text?: string }>;
  }>;
  currency: string;
  totals: Array<{ type: string; amount: number; display_text?: string }>;
  messages: Array<{
    type: string;
    code: string;
    content: string;
    severity?: string;
    path?: string;
  }>;
  continue_url?: string;
  expires_at?: string;
  links?: Array<{ type: string; url: string; title?: string }>;
  order?: { id: string; permalink_url?: string };
}

export function isUcpCheckoutTool(toolName: string): boolean {
  return UCP_CHECKOUT_TOOLS.has(toolName);
}

export function parseUcpCheckoutResponse(
  result: ToolResult
): UcpCheckoutData | null {
  try {
    if (!result || !result.content) {
      console.warn("[UCP] No result or content in tool response");
      return null;
    }
    const textContent = result.content.find((c) => c.type === "text");
    if (!textContent?.text) {
      console.warn("[UCP] No text content in tool response", result.content);
      return null;
    }

    const parsed = JSON.parse(textContent.text);
    if (parsed.ucp && parsed.id && parsed.status) {
      return parsed as UcpCheckoutData;
    }
    console.warn("[UCP] Parsed response missing ucp/id/status", parsed);
    return null;
  } catch (e) {
    console.error("[UCP] Failed to parse checkout response", e);
    return null;
  }
}

export function formatPrice(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(major);
}
