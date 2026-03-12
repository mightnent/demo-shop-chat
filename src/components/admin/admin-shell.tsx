"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, MessageSquare, FileText, ArrowLeft, Link2 } from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/sessions", label: "Sessions", icon: MessageSquare },
  { href: "/admin/claims-routes", label: "Claims Routes", icon: Link2 },
  { href: "/admin/audit", label: "Audit Log", icon: FileText },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex h-dvh min-h-0 bg-background">
      <aside className="w-56 border-r flex flex-col bg-muted/30">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-sm">Admin</h2>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-2 border-t">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Chat
          </Link>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  );
}
