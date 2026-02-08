import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatSessions, users, chatMessages } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { desc, eq, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = (page - 1) * limit;

    const results = await db
      .select({
        id: chatSessions.id,
        userId: chatSessions.userId,
        tenantId: chatSessions.tenantId,
        status: chatSessions.status,
        startedAt: chatSessions.startedAt,
        endedAt: chatSessions.endedAt,
        userEmail: users.email,
        userDisplayName: users.displayName,
        messageCount: sql<number>`(
          SELECT count(*) FROM chat_messages
          WHERE chat_messages.session_id = ${chatSessions.id}
        )`,
      })
      .from(chatSessions)
      .leftJoin(users, eq(chatSessions.userId, users.id))
      .orderBy(desc(chatSessions.startedAt))
      .limit(limit)
      .offset(offset);

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(chatSessions);

    return NextResponse.json({
      sessions: results,
      total: Number(count),
      page,
      limit,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json(
      { error: "Failed to list sessions" },
      { status: 500 }
    );
  }
}
