import { getIronSession, IronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  userId: string;
  email: string;
  role: "user" | "admin";
  tenantId: string;
  isLoggedIn: boolean;
}

const sessionOptions = {
  password: process.env.SESSION_COOKIE_SECRET || "fallback-secret-must-be-at-least-32-characters-long",
  cookieName: "chathost_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getSession();
  if (!session.isLoggedIn || !session.userId) {
    throw new Error("UNAUTHORIZED");
  }
  return {
    userId: session.userId,
    email: session.email,
    role: session.role,
    tenantId: session.tenantId,
    isLoggedIn: true,
  };
}

export async function requireAdmin(): Promise<SessionData> {
  const session = await requireAuth();
  if (session.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return session;
}
