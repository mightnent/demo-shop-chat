import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userOauthAccounts } from "@/lib/db/schema";
import { decryptToken, encryptToken } from "@/lib/auth/crypto";
import { requireAuth } from "@/lib/auth/session";
import { eq, and } from "drizzle-orm";

export async function POST() {
  try {
    const session = await requireAuth();

    // Get stored refresh token
    const [oauth] = await db
      .select()
      .from(userOauthAccounts)
      .where(
        and(
          eq(userOauthAccounts.userId, session.userId),
          eq(userOauthAccounts.provider, "cognito")
        )
      )
      .limit(1);

    if (!oauth?.refreshTokenEncrypted) {
      return NextResponse.json(
        { error: "No refresh token available" },
        { status: 400 }
      );
    }

    const refreshToken = decryptToken(oauth.refreshTokenEncrypted);

    // Call Cognito token endpoint
    const region = process.env.COGNITO_REGION || "us-east-1";
    const clientId = process.env.COGNITO_APP_CLIENT_ID!;
    const tokenUrl = `https://cognito-idp.${region}.amazonaws.com/`;

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: {
          REFRESH_TOKEN: refreshToken,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Cognito refresh failed: ${response.status}`);
    }

    const result = await response.json();
    const authResult = result.AuthenticationResult;

    // Update stored tokens
    await db
      .update(userOauthAccounts)
      .set({
        accessTokenEncrypted: encryptToken(authResult.AccessToken),
        expiresAt: new Date(Date.now() + authResult.ExpiresIn * 1000),
        lastRefreshAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userOauthAccounts.id, oauth.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[auth/refresh] Error:", error);
    return NextResponse.json(
      { error: "Token refresh failed" },
      { status: 500 }
    );
  }
}
