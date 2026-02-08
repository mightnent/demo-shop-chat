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
NEXT_PUBLIC_AUTH_ENABLED=true

# Cognito settings
COGNITO_USER_POOL_ID=your-user-pool-id
COGNITO_APP_CLIENT_ID=your-app-client-id
COGNITO_REGION=your-region
COGNITO_ISSUER=https://cognito-idp.<region>.amazonaws.com/<user-pool-id>
NEXT_PUBLIC_COGNITO_REGION=your-region
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=your-app-client-id
NEXT_PUBLIC_COGNITO_DOMAIN=your-cognito-domain-prefix

# Comma-separated admin emails
ADMIN_EMAILS=admin1@example.com,admin2@example.com
```

Notes:
- No local admin user seeding is required.
- Users are created in the app database on first successful Cognito login.
- A user gets `admin` role only if their email is in `ADMIN_EMAILS` or their Cognito groups include `admin`.

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

## Audit Logging Scope

This project intentionally keeps audit writes minimal and only records
`auth.token_exchange` events.

The following event categories are intentionally not emitted right now:
- chat session lifecycle events (for example `chat.session_start`)
- chat message lifecycle events (for example `chat.message_sent`, `chat.message_received`)
- admin page/view events
- token refresh/logout events

Rationale:
- this app is expected to run at high chat volume
- writing every session/message lifecycle event can create unnecessary DB growth
- token exchange remains logged as the highest-value auth audit signal for this project stage

If you re-enable broader audit logging later, do it deliberately with retention limits,
separate storage/routing for high-volume events, and clear event namespaces.
