"use client";

import React from "react";
import { useAuth } from "./auth-provider";
import { Button } from "@/components/ui/button";

export function LoginDialog() {
  const { login } = useAuth();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-semibold">Welcome to Chat Host</h2>
        <p className="text-muted-foreground">
          Sign in to start chatting
        </p>
      </div>
      <Button onClick={login} size="lg">
        Sign in with Cognito
      </Button>
    </div>
  );
}
