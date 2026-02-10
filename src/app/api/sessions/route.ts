import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatSessions, chatMessages } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { eq, desc, and, asc, inArray } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireAuth();

    const sessions = await db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        tenantId: chatSessions.tenantId,
        status: chatSessions.status,
        startedAt: chatSessions.startedAt,
        endedAt: chatSessions.endedAt,
        endedReason: chatSessions.endedReason,
        traceId: chatSessions.traceId,
        requestId: chatSessions.requestId,
        clientContext: chatSessions.clientContext,
      })
      .from(chatSessions)
      .where(eq(chatSessions.userId, session.userId))
      .orderBy(desc(chatSessions.startedAt))
      .limit(50);

    // Enrich with preview + messageCount via a single query
    const sessionIds = sessions.map((s) => s.id);
    let previews: Record<string, { preview: string | null; messageCount: number }> = {};

    if (sessionIds.length > 0) {
      const rows = await db
        .select({
          sessionId: chatMessages.sessionId,
          content: chatMessages.content,
          role: chatMessages.role,
        })
        .from(chatMessages)
        .where(
          and(
            inArray(chatMessages.sessionId, sessionIds),
            eq(chatMessages.userId, session.userId)
          )
        )
        .orderBy(asc(chatMessages.createdAt));

      for (const row of rows) {
        if (!previews[row.sessionId]) {
          previews[row.sessionId] = { preview: null, messageCount: 0 };
        }
        previews[row.sessionId].messageCount++;
        if (row.role === "user" && !previews[row.sessionId].preview) {
          previews[row.sessionId].preview = row.content.substring(0, 100);
        }
      }
    }

    const enriched = sessions.map((s) => ({
      ...s,
      preview: previews[s.id]?.preview ?? null,
      messageCount: previews[s.id]?.messageCount ?? 0,
    }));

    return NextResponse.json({ sessions: enriched });
  } catch (error) {
    console.error("[sessions/GET]", error);
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to list sessions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const body = await request.json().catch(() => ({}));

    const [chatSession] = await db
      .insert(chatSessions)
      .values({
        userId: session.userId,
        tenantId: session.tenantId,
        status: "active",
        traceId: body.traceId || null,
        clientContext: body.clientContext || null,
      })
      .returning();

    // Intentionally no audit event for chat session lifecycle to avoid high-volume writes.
    // See README section "Audit Logging Scope".

    return NextResponse.json({ session: chatSession }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
