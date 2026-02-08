import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, userOauthAccounts } from "@/lib/db/schema";
import { verifyCognitoIdToken } from "@/lib/auth/cognito";
import { encryptToken } from "@/lib/auth/crypto";
import { getSession } from "@/lib/auth/session";
import { auditLog } from "@/lib/services/audit";
import { eq, and } from "drizzle-orm";

function normalizeEmail(email?: string | null): string {
  return (email || "").trim().toLowerCase();
}

function getAdminEmailSet(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || "";
  const emails = raw
    .split(",")
    .map((email) => normalizeEmail(email))
    .filter(Boolean);

  return new Set(emails);
}

function isAdminFromClaims(claims: {
  email?: string;
  "cognito:groups"?: string[];
}): boolean {
  const normalizedEmail = normalizeEmail(claims.email);
  const adminEmailSet = getAdminEmailSet();
  const byEmail = normalizedEmail ? adminEmailSet.has(normalizedEmail) : false;
  const byGroup = (claims["cognito:groups"] || []).some(
    (group) => group.toLowerCase() === "admin"
  );
  return byEmail || byGroup;
}

export async function POST(request: Request) {
  const start = Date.now();
  try {
    const body = await request.json();
    const { id_token, access_token, refresh_token, expires_in } = body;

    if (!id_token) {
      return NextResponse.json({ error: "id_token required" }, { status: 400 });
    }

    // Verify Cognito ID token
    const claims = await verifyCognitoIdToken(id_token);
    const tenantId = "default";
    const sub = claims.sub;
    const email = claims.email;
    const normalizedEmail = normalizeEmail(email);
    const displayName = [claims.given_name, claims.family_name]
      .filter(Boolean)
      .join(" ") || email;
    const role = isAdminFromClaims(claims) ? "admin" : "user";

    // Upsert by Cognito subject first.
    const existingByExternalId = await db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.externalUserId, sub)))
      .limit(1);

    let userId: string;

    if (existingByExternalId.length > 0) {
      userId = existingByExternalId[0].id;
      await db
        .update(users)
        .set({
          email,
          displayName,
          avatarUrl: claims.picture || null,
          role,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } else {
      // Fallback by email to adopt an existing pre-seeded user row and avoid duplicates.
      const existingByEmail = normalizedEmail
        ? await db
            .select()
            .from(users)
            .where(and(eq(users.tenantId, tenantId), eq(users.email, email)))
            .limit(1)
        : [];

      if (existingByEmail.length > 0) {
        userId = existingByEmail[0].id;
        await db
          .update(users)
          .set({
            externalUserId: sub,
            email,
            displayName,
            avatarUrl: claims.picture || null,
            role,
            lastSeenAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));
      } else {
        const [inserted] = await db
          .insert(users)
          .values({
            tenantId,
            externalUserId: sub,
            email,
            displayName,
            avatarUrl: claims.picture || null,
            role,
            status: "active",
          })
          .returning();
        userId = inserted.id;
      }
    }

    // Upsert OAuth account with encrypted tokens
    const existingOauth = await db
      .select()
      .from(userOauthAccounts)
      .where(
        and(
          eq(userOauthAccounts.tenantId, tenantId),
          eq(userOauthAccounts.provider, "cognito"),
          eq(userOauthAccounts.providerSubject, sub)
        )
      )
      .limit(1);

    const tokenData = {
      accessTokenEncrypted: access_token ? encryptToken(access_token) : null,
      refreshTokenEncrypted: refresh_token ? encryptToken(refresh_token) : null,
      tokenType: "Bearer",
      expiresAt: expires_in
        ? new Date(Date.now() + expires_in * 1000)
        : null,
      lastRefreshAt: new Date(),
      updatedAt: new Date(),
    };

    if (existingOauth.length > 0) {
      await db
        .update(userOauthAccounts)
        .set(tokenData)
        .where(eq(userOauthAccounts.id, existingOauth[0].id));
    } else {
      await db.insert(userOauthAccounts).values({
        userId,
        tenantId,
        provider: "cognito",
        providerSubject: sub,
        ...tokenData,
      });
    }

    // Create session cookie
    const session = await getSession();
    session.userId = userId;
    session.email = email;
    session.role = role;
    session.tenantId = tenantId;
    session.isLoggedIn = true;
    await session.save();

    await auditLog({
      tenantId,
      userId,
      eventType: "auth.token_exchange",
      eventStatus: "success",
      eventSource: "cognito",
      latencyMs: Date.now() - start,
    });

    return NextResponse.json({
      user: { id: userId, email, displayName, role },
    });
  } catch (error) {
    await auditLog({
      eventType: "auth.token_exchange",
      eventStatus: "error",
      eventSource: "cognito",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      latencyMs: Date.now() - start,
    });

    console.error("[auth/exchange] Error:", error);
    return NextResponse.json(
      { error: "Token exchange failed" },
      { status: 401 }
    );
  }
}
