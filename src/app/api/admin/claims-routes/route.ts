import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import {
  ClaimsRouteValidationError,
  createClaimsRoute,
  listClaimsRoutes,
} from "@/lib/claims-routes";

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("claims_routes_tenant_key_idx") ||
    error.message.toLowerCase().includes("duplicate key")
  );
}

export async function GET() {
  try {
    const session = await requireAdmin();
    const routes = await listClaimsRoutes(session.tenantId);
    return NextResponse.json({ routes });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to list claims routes" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireAdmin();
    const body = await request.json();
    const route = await createClaimsRoute(body, session.tenantId);
    return NextResponse.json({ route }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error instanceof ClaimsRouteValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: "Route key already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create claims route" }, { status: 500 });
  }
}
