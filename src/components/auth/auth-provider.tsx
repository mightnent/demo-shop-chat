"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { MOCK_USER } from "@/lib/mock-user";

export interface AuthUser {
  id: string;
  email: string;
  role: "user" | "admin";
  displayName?: string;
  tenantId?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  isLoading: true,
  login: () => {},
  logout: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const IS_AUTH_ENABLED =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

const MOCK_AUTH_USER: AuthUser = {
  id: MOCK_USER.id,
  email: MOCK_USER.email,
  role: "admin", // demo mode gets admin access
  displayName: `${MOCK_USER.firstName} ${MOCK_USER.lastName}`,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function initAuth() {
      if (!IS_AUTH_ENABLED) {
        setUser(MOCK_AUTH_USER);
        setIsLoading(false);
        return;
      }

      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        const region = process.env.NEXT_PUBLIC_COGNITO_REGION || "us-east-1";
        const clientId = process.env.NEXT_PUBLIC_COGNITO_APP_CLIENT_ID || "";
        const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN || "";
        const redirectUri = window.location.origin + "/";

        if (!clientId || !domain) {
          console.error(
            "Missing NEXT_PUBLIC_COGNITO_APP_CLIENT_ID or NEXT_PUBLIC_COGNITO_DOMAIN"
          );
        } else {
          try {
            const tokenRes = await fetch(
              `https://${domain}.auth.${region}.amazoncognito.com/oauth2/token`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                  grant_type: "authorization_code",
                  client_id: clientId,
                  code,
                  redirect_uri: redirectUri,
                }),
              }
            );

            if (!tokenRes.ok) {
              throw new Error(`Token endpoint failed (${tokenRes.status})`);
            }

            const tokens = await tokenRes.json();
            const exchangeRes = await fetch("/api/auth/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id_token: tokens.id_token,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_in: tokens.expires_in,
              }),
            });

            if (!exchangeRes.ok) {
              throw new Error(`Session exchange failed (${exchangeRes.status})`);
            }
          } catch (error) {
            console.error("Failed to complete auth callback", error);
          }
        }

        url.searchParams.delete("code");
        url.searchParams.delete("state");
        window.history.replaceState({}, "", url.toString());
      }

      // Fetch current user from session
      fetch("/api/auth/me")
        .then((res) => res.json())
        .then((data) => {
          if (data.user) {
            setUser(data.user);
          }
        })
        .catch(() => {})
        .finally(() => setIsLoading(false));
    }

    initAuth();
  }, []);

  const login = () => {
    if (!IS_AUTH_ENABLED) return;

    // Redirect to Cognito hosted UI
    const region = process.env.NEXT_PUBLIC_COGNITO_REGION || "us-east-1";
    const clientId = process.env.NEXT_PUBLIC_COGNITO_APP_CLIENT_ID || "";
    const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN || "";

    if (!clientId || !domain) {
      console.error(
        "Missing NEXT_PUBLIC_COGNITO_APP_CLIENT_ID or NEXT_PUBLIC_COGNITO_DOMAIN"
      );
      return;
    }

    const redirectUri = encodeURIComponent(window.location.origin + "/");

    window.location.href = `https://${domain}.auth.${region}.amazoncognito.com/login?client_id=${clientId}&response_type=code&scope=email+openid+profile&redirect_uri=${redirectUri}`;
  };

  const logout = async () => {
    if (!IS_AUTH_ENABLED) return;

    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setUser(null);
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isAdmin: user?.role === "admin",
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
