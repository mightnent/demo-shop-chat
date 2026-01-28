# Chat Host

MCP-compatible chat interface for discovering and interacting with EV charging MCP servers.

## Features

- **MCP Server Discovery**: Connect to any MCP-compatible server
- **MCP-UI Rendering**: Render interactive UI components from MCP servers using `@mcp-ui/client`
- **OpenAI Integration**: AI-powered chat with tool calling
- **Monochrome UI**: Clean, minimal interface with shadcn/ui

## Tech Stack

- Next.js 14
- React 18
- TypeScript
- Tailwind CSS
- shadcn/ui (monochrome theme)
- @mcp-ui/client
- OpenAI SDK

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm
- OpenAI API key

### Installation

```bash
cd chat-host
npm install
```

### Environment Variables

Create a `.env` file:

```bash
NEXT_PUBLIC_OPENAI_API_KEY=your-openai-api-key
```

### Development

```bash
npm run dev
```

The chat host will be available at `http://localhost:3000`.

## Usage

1. Start the chat host
2. Enter an MCP server URL (e.g., `http://localhost:3001/api/mcp`)
3. Click "+" to connect
4. Start chatting - the AI will discover and use available tools

## Architecture

```
src/
├── app/
│   ├── globals.css      # Tailwind + shadcn/ui monochrome theme
│   ├── layout.tsx       # Root layout
│   └── page.tsx         # Main page
├── components/
│   ├── chat/
│   │   ├── chat-container.tsx  # Main chat container
│   │   ├── chat-input.tsx      # Message input
│   │   ├── message-bubble.tsx  # Message display with UI rendering
│   │   └── server-panel.tsx    # MCP server connection panel
│   └── ui/              # shadcn/ui components
├── lib/
│   ├── chat-store.ts    # In-memory chat state
│   ├── mcp-client.ts    # MCP protocol client
│   └── utils.ts         # Utilities
```

## MCP-UI Integration

The chat host uses `@mcp-ui/client` to render UI resources from MCP servers:

```tsx
import { UIResourceRenderer } from "@mcp-ui/client";

<UIResourceRenderer
  resource={message.uiResource}
  onUIAction={handleUIAction}
/>
```

UI actions (tool calls, prompts) are handled and can trigger additional MCP tool calls.
