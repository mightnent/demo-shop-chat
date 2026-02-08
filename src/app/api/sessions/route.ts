import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireAuth();

    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, session.userId))
      .orderBy(desc(chatSessions.startedAt))
      .limit(50);

    return NextResponse.json({ sessions });
  } catch (error) {
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
