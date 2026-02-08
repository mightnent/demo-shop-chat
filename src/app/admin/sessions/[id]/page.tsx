"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface MessageRow {
  id: string;
  role: string;
  content: string;
  modelName: string | null;
  createdAt: string;
}

export default function AdminSessionDetailPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/sessions/${sessionId}/messages`)
      .then((res) => res.json())
      .then((data) => setMessages(data.messages || []))
      .catch(() => console.error("Failed to fetch messages"))
      .finally(() => setLoading(false));
  }, [sessionId]);

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/sessions">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Session Detail</h1>
          <p className="text-xs text-muted-foreground font-mono">{sessionId}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Loading messages...</p>
      ) : messages.length === 0 ? (
        <p className="text-muted-foreground">No messages in this session</p>
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`p-4 rounded-lg border ${
                msg.role === "user"
                  ? "bg-primary/5 border-primary/20"
                  : msg.role === "assistant"
                  ? "bg-muted/50"
                  : "bg-yellow-50 border-yellow-200"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-xs font-medium ${
                    msg.role === "user"
                      ? "text-primary"
                      : msg.role === "assistant"
                      ? "text-muted-foreground"
                      : "text-yellow-700"
                  }`}
                >
                  {msg.role}
                  {msg.modelName && (
                    <span className="ml-2 text-muted-foreground font-normal">
                      ({msg.modelName})
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(msg.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
