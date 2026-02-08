import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatMessages } from "@/lib/db/schema";
import { requireAuth } from "@/lib/auth/session";
import { eq, and, asc } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId required" },
        { status: 400 }
      );
    }

    const messages = await db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, sessionId),
          eq(chatMessages.userId, session.userId)
        )
      )
      .orderBy(asc(chatMessages.createdAt));

    return NextResponse.json({ messages });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to list messages" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const body = await request.json();
    const { sessionId, role, content, modelName } = body;

    if (!sessionId || !role || !content) {
      return NextResponse.json(
        { error: "sessionId, role, and content required" },
        { status: 400 }
      );
    }

    const [message] = await db
      .insert(chatMessages)
      .values({
        sessionId,
        userId: session.userId,
        tenantId: session.tenantId,
        role,
        content,
        modelName: modelName || null,
      })
      .returning();

    // Intentionally no audit event for message send/receive to avoid high-volume writes.
    // See README section "Audit Logging Scope".

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 });
  }
}
