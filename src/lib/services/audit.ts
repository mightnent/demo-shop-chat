import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";

export type AuditEventType =
  | "auth.token_exchange"
  | "auth.login"
  | "auth.logout"
  | "auth.token_refresh"
  | "chat.session_start"
  | "chat.session_end"
  | "chat.message_sent"
  | "chat.message_received"
  | "mcp.tool.called"
  | "mcp.tool.succeeded"
  | "mcp.tool.failed"
  | "admin.user_view"
  | "admin.user_update"
  | "admin.session_view"
  | "admin.audit_view"
  | "system.error";

export interface AuditLogParams {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
  eventType: AuditEventType;
  eventStatus?: string;
  eventSource?: string;
  payload?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  latencyMs?: number;
  traceId?: string;
  requestId?: string;
}

/**
 * Audit logger. All DB writes are wrapped in try-catch
 * so failures never block the app.
 *
 * Current project policy: only auth.token_exchange is emitted by API routes.
 * Other event types remain in the union for forward compatibility if re-enabled.
 */
export async function auditLog(params: AuditLogParams): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      tenantId: params.tenantId || "default",
      userId: params.userId || null,
      sessionId: params.sessionId || null,
      eventType: params.eventType,
      eventStatus: params.eventStatus || null,
      eventSource: params.eventSource || null,
      payloadJson: params.payload || null,
      errorCode: params.errorCode || null,
      errorMessageRedacted: params.errorMessage || null,
      latencyMs: params.latencyMs || null,
      traceId: params.traceId || null,
      requestId: params.requestId || null,
    });
  } catch (error) {
    console.error("[audit] Failed to write audit event:", params.eventType, error);
  }
}
