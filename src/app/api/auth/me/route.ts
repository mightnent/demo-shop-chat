import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export async function GET() {
  try {
    const session = await getSession();

    if (!session.isLoggedIn || !session.userId) {
      return NextResponse.json({ user: null });
    }

    return NextResponse.json({
      user: {
        id: session.userId,
        email: session.email,
        role: session.role,
        tenantId: session.tenantId,
      },
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}
