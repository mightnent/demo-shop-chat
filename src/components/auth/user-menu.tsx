"use client";

import React from "react";
import { useAuth } from "./auth-provider";
import Link from "next/link";
import { LogOut, Shield, User } from "lucide-react";

export function UserMenu() {
  const { user, isAdmin, logout } = useAuth();

  if (!user) return null;

  const initials = user.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user.email[0].toUpperCase();

  return (
    <div className="flex items-center gap-2 sm:gap-4">
      {isAdmin && (
        <Link
          href="/admin"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <Shield className="h-3 w-3" />
          Admin
        </Link>
      )}
      <div className="flex items-center gap-2 sm:pl-4 sm:border-l">
        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          <span className="text-xs font-medium text-primary">{initials}</span>
        </div>
        <div className="hidden sm:block">
          <p className="text-sm font-medium">
            {user.displayName || user.email}
          </p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
        </div>
      </div>
      {process.env.NEXT_PUBLIC_AUTH_ENABLED === "true" && (
        <button
          onClick={logout}
          className="text-muted-foreground hover:text-foreground"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
