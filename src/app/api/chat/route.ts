import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.NEXT_PUBLIC_OPENAI_API_KEY || "",
});

export async function POST(request: Request) {
  try {
    await requireAuth();

    const body = await request.json();
    const { messages, tools, tool_choice, model } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array required" },
        { status: 400 }
      );
    }

    const response = await openai.chat.completions.create({
      model: model || "gpt-4o",
      messages,
      tools: tools?.length > 0 ? tools : undefined,
      tool_choice: tools?.length > 0 ? (tool_choice || "auto") : undefined,
    });

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[api/chat] Error:", error);
    return NextResponse.json(
      { error: "Chat request failed" },
      { status: 500 }
    );
  }
}
