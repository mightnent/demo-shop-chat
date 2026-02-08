import * as jose from "jose";

let jwksCache: jose.JWTVerifyGetKey | null = null;

function getJWKS(): jose.JWTVerifyGetKey {
  if (!jwksCache) {
    const region = process.env.COGNITO_REGION || "us-east-1";
    const userPoolId = process.env.COGNITO_USER_POOL_ID!;
    const jwksUrl = new URL(
      `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`
    );
    jwksCache = jose.createRemoteJWKSet(jwksUrl);
  }
  return jwksCache;
}

function getIssuer(): string {
  if (process.env.COGNITO_ISSUER) return process.env.COGNITO_ISSUER;
  const region = process.env.COGNITO_REGION || "us-east-1";
  const userPoolId = process.env.COGNITO_USER_POOL_ID!;
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

export interface CognitoIdTokenPayload {
  sub: string;
  email: string;
  email_verified: boolean;
  "cognito:username": string;
  "cognito:groups"?: string[];
  given_name?: string;
  family_name?: string;
  picture?: string;
}

export async function verifyCognitoIdToken(
  token: string
): Promise<CognitoIdTokenPayload> {
  const jwks = getJWKS();
  const { payload } = await jose.jwtVerify(token, jwks, {
    issuer: getIssuer(),
    audience: process.env.COGNITO_APP_CLIENT_ID!,
  });

  if (payload.token_use !== "id") {
    throw new Error("Token is not an id token");
  }

  return payload as unknown as CognitoIdTokenPayload;
}

export async function verifyCognitoAccessToken(
  token: string
): Promise<jose.JWTPayload> {
  const jwks = getJWKS();
  const { payload } = await jose.jwtVerify(token, jwks, {
    issuer: getIssuer(),
  });

  if (payload.token_use !== "access") {
    throw new Error("Token is not an access token");
  }

  return payload;
}
