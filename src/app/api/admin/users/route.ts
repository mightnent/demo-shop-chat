import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireAdmin } from "@/lib/auth/session";
import { ilike, desc, sql } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = (page - 1) * limit;

    let query = db.select().from(users);

    if (search) {
      query = query.where(ilike(users.email, `%${search}%`)) as typeof query;
    }

    const results = await query
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    let countQuery = db.select({ count: sql<number>`count(*)` }).from(users);
    if (search) {
      countQuery = countQuery.where(ilike(users.email, `%${search}%`)) as typeof countQuery;
    }
    const [{ count }] = await countQuery;

    return NextResponse.json({
      users: results,
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
    return NextResponse.json({ error: "Failed to list users" }, { status: 500 });
  }
}
