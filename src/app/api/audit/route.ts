import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const eventType = searchParams.get("eventType");
    const userId = searchParams.get("userId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = (page - 1) * limit;

    const conditions = [];
    if (eventType) conditions.push(eq(auditEvents.eventType, eventType));
    if (userId) conditions.push(eq(auditEvents.userId, userId));
    if (dateFrom) conditions.push(gte(auditEvents.createdAt, new Date(dateFrom)));
    if (dateTo) conditions.push(lte(auditEvents.createdAt, new Date(dateTo)));

    let query = db.select().from(auditEvents);
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const results = await query
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit)
      .offset(offset);

    // Count
    let countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(auditEvents);
    if (conditions.length > 0) {
      countQuery = countQuery.where(and(...conditions)) as typeof countQuery;
    }
    const [{ count }] = await countQuery;

    return NextResponse.json({
      events: results,
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
      { error: "Failed to list audit events" },
      { status: 500 }
    );
  }
}
