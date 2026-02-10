"use client";

import React, { useEffect, useRef } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import Link from "next/link";
import { LogOut, Shield, SquarePen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SlideOutMenuProps {
  open: boolean;
  onClose: () => void;
  onNewChat: () => void;
}

export function SlideOutMenu({ open, onClose, onNewChat }: SlideOutMenuProps) {
  const { user, isAdmin, logout } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const initials = user?.displayName
    ? user.displayName
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : user?.email?.[0]?.toUpperCase() || "?";

  const handleNewChat = () => {
    onNewChat();
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />

      {/* Slide-out panel */}
      <div
        ref={panelRef}
        className={cn(
          "fixed top-0 right-0 z-50 h-full w-72 bg-background border-l shadow-xl",
          "flex flex-col transition-transform duration-300 ease-in-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Top section: close + New Chat */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Menu</span>
            <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <button
            onClick={handleNewChat}
            className="flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
          >
            <SquarePen className="h-4 w-4" />
            New Chat
          </button>
        </div>

        {/* Middle spacer */}
        <div className="flex-1" />

        {/* Bottom section: admin link, profile, logout */}
        <div className="p-4 border-t space-y-3">
          {isAdmin && (
            <Link
              href="/admin"
              onClick={onClose}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <Shield className="h-4 w-4" />
              Admin
            </Link>
          )}

          {user && (
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-xs font-medium text-primary">{initials}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {user.displayName || user.email}
                </p>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          )}

          {process.env.NEXT_PUBLIC_AUTH_ENABLED === "true" && (
            <button
              onClick={() => {
                onClose();
                logout();
              }}
              className="flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-destructive hover:bg-accent transition-colors"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          )}
        </div>
      </div>
    </>
  );
}
