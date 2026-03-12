import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/session";
import {
  ClaimsRouteValidationError,
  deleteClaimsRoute,
  updateClaimsRoute,
} from "@/lib/claims-routes";

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message.includes("claims_routes_tenant_key_idx") ||
    error.message.toLowerCase().includes("duplicate key")
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const route = await updateClaimsRoute(id, body, session.tenantId);
    if (!route) {
      return NextResponse.json({ error: "Claims route not found" }, { status: 404 });
    }
    return NextResponse.json({ route });
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
    return NextResponse.json({ error: "Failed to update claims route" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const deleted = await deleteClaimsRoute(id, session.tenantId);
    if (!deleted) {
      return NextResponse.json({ error: "Claims route not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to delete claims route" }, { status: 500 });
  }
}
