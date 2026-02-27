# Chat Host

An open-source, MCP-compatible chat interface for discovering and interacting with [Universal Commerce Protocol (UCP)](https://ucp.dev/2026-01-23/) MCP servers. Chat Host bridges AI models and commerce systems, enabling agentic product discovery, checkout, and payment flows through natural conversation.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start (Demo Mode)](#quick-start-demo-mode)
- [Full Setup (With Auth & Database)](#full-setup-with-auth--database)
- [Environment Variables](#environment-variables)
- [Running the App](#running-the-app)
- [How It Works](#how-it-works)
  - [Chat Flow](#chat-flow)
  - [MCP Server Connections](#mcp-server-connections)
  - [UCP Checkout Flow](#ucp-checkout-flow)
  - [Embedded Checkout Protocol (ECP)](#embedded-checkout-protocol-ecp)
  - [Authentication](#authentication)
  - [Guardrails & Moderation](#guardrails--moderation)
  - [Chat History & Persistence](#chat-history--persistence)
- [Key Routes](#key-routes)
- [API Reference](#api-reference)
- [Database Schema](#database-schema)
- [UCP Compliance Center](#ucp-compliance-center)
- [Admin Dashboard](#admin-dashboard)
- [Project Structure](#project-structure)
- [Architecture & Design Decisions](#architecture--design-decisions)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **MCP Server Discovery** — connect to any MCP-compatible server by URL and browse its tools
- **UCP Compliance Center** — validate MCP servers against the UCP spec (tool check + profile discovery) at `/ucp`
- **MCP-UI Rendering** — render interactive UI components returned by MCP servers via `@mcp-ui/client`
- **Embedded Checkout (ECP)** — host embedded checkout iframes from UCP servers with JSON-RPC message passing
- **OpenAI Integration** — AI-powered chat using OpenAI's Responses API with full tool-calling support
- **Guardrails** — input/output moderation via OpenAI Moderation API, editable system instructions
- **Auth (optional)** — AWS Cognito OAuth with JWT verification, AES-256-GCM token encryption, and iron-session cookies
- **Chat History** — persistent chat sessions and message history with slide-out sidebar
- **Admin Dashboard** — user management, session viewer, and audit log at `/admin`
- **Demo Mode** — runs without any database or auth setup for quick local development

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 + shadcn/ui (Radix UI primitives) |
| AI | OpenAI SDK (`openai` ^4) — Responses API for tool calling |
| MCP | `@modelcontextprotocol/sdk` ^1.0.0 + `@mcp-ui/client` ^5.17.3 |
| Database | Neon Postgres (serverless) via Drizzle ORM |
| Auth | AWS Cognito JWT verification (`jose`), AES-256-GCM token encryption, `iron-session` cookies |
| ORM | Drizzle ORM + `drizzle-kit` for migrations |

---

## Prerequisites

- **Node.js 18+** and **npm**
- **OpenAI API key** (required for all modes)
- **Neon Postgres database** (only required when auth is enabled)
- **AWS Cognito app** (only required when auth is enabled)

## Quick Start (Demo Mode)

Demo mode runs the app without authentication, database, or Cognito. A mock user (`john.doe@example.com` with admin role) is injected automatically, and the OpenAI API is called directly from the browser.

**1. Clone and install:**

```bash
git clone https://github.com/anthropics/agentic-commerce-discovery.git
cd agentic-commerce-discovery/chat-host
npm install
```

**2. Create your environment file:**

```bash
cp .env.example .env.local
```

**3. Edit `.env.local` with the minimum required values:**

```bash
# The only required variable for demo mode
OPENAI_API_KEY=sk-...

# Demo mode — no database or Cognito needed
NEXT_PUBLIC_AUTH_ENABLED=false
```

**4. Start the dev server:**

```bash
npm run dev
```

**5. Open [http://localhost:3000](http://localhost:3000).**

You'll see the chat interface immediately — no login required. Connect an MCP server from the sidebar to start chatting with tool support.

---

## Full Setup (With Auth & Database)

When `NEXT_PUBLIC_AUTH_ENABLED=true`, the app uses AWS Cognito for authentication, Neon Postgres for data persistence, and routes all OpenAI calls through a server-side proxy with guardrails.

### 1. Set up Neon Postgres

Create a [Neon](https://neon.tech) database and copy the connection string.

### 2. Set up AWS Cognito

1. Create a Cognito User Pool with a Hosted UI.
2. Create an App Client (note the client ID).
3. Configure the callback URL to `http://localhost:3000` (and your production URL).
4. Note your User Pool ID, region, and Cognito domain prefix.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in all values (see [Environment Variables](#environment-variables) for the complete reference).

### 4. Run database migrations

```bash
# Generate migration files from the Drizzle schema
npm run db:generate

# Apply migrations to your Neon database
npm run db:migrate
```

Or for rapid development without migration files:

```bash
npm run db:push
```

### 5. (Optional) Seed the admin user

```bash
npm run db:seed
```

> **Note:** Users are also auto-created on first Cognito login, so seeding is optional. Users get the `admin` role if their email is in `ADMIN_EMAILS` or they belong to an `admin` group in Cognito.

### 6. Start the app

```bash
npm run dev
```

---

## Environment Variables

Create a `.env.local` file in the `chat-host` directory. Here's the complete reference:

### Required (All Modes)

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key (server-side). Used by `/api/chat` route. |

### Demo Mode Only

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_OPENAI_MODEL` | Model name override (default: `gpt-5.2`). |

### Auth Toggle

| Variable | Values | Description |
|---|---|---|
| `NEXT_PUBLIC_AUTH_ENABLED` | `true` / `false` | `false` = demo mode (no auth, no DB). `true` = Cognito auth + DB persistence. |

### Required When Auth Enabled (`NEXT_PUBLIC_AUTH_ENABLED=true`)

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (e.g., `postgresql://user:pass@host/db?sslmode=require`) |
| `SESSION_COOKIE_SECRET` | Random string, 32+ characters. Used by iron-session to encrypt the session cookie. |
| `TOKEN_ENCRYPTION_KEY` | 64 hex characters (32 bytes). Used for AES-256-GCM encryption of stored OAuth tokens. |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID (e.g., `us-east-1_XXXXXXXXX`) |
| `COGNITO_APP_CLIENT_ID` | Cognito App Client ID |
| `COGNITO_REGION` | AWS region (e.g., `us-east-1`) |
| `COGNITO_ISSUER` | Cognito issuer URL: `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>` |
| `NEXT_PUBLIC_COGNITO_REGION` | Same region, exposed to browser for OAuth redirect |
| `NEXT_PUBLIC_COGNITO_APP_CLIENT_ID` | Same client ID, exposed to browser |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | Cognito domain prefix (e.g., `myapp` for `myapp.auth.us-east-1.amazoncognito.com`) |

### Optional

| Variable | Default | Description |
|---|---|---|
| `OPENAI_MODEL` | `gpt-5.2` | Model used by the server-side `/api/chat` proxy |
| `ADMIN_EMAILS` | (none) | Comma-separated list of emails that get the `admin` role on first login |
| `NEXT_PUBLIC_DEFAULT_MCP_SERVER_URL` | (none) | MCP server URL to always seed into the saved server list on startup |
| `NEXT_PUBLIC_DEFAULT_MCP_SERVER_NAME` | hostname from URL | Optional display name used with `NEXT_PUBLIC_DEFAULT_MCP_SERVER_URL` |

### Guardrails

| Variable | Default | Description |
|---|---|---|
| `GUARDRAILS_ENABLED` | `true` | Master switch for all guardrails (system instructions, moderation) |
| `GUARDRAILS_INPUT_MODERATION` | `true` | Run OpenAI Moderation on user input before calling the model |
| `GUARDRAILS_OUTPUT_MODERATION` | `true` | Run OpenAI Moderation on assistant output before returning it |
| `GUARDRAILS_FAIL_CLOSED` | `true` | If the moderation API errors out, block the request (vs. allowing it through) |

### Generating Encryption Keys

```bash
# Generate TOKEN_ENCRYPTION_KEY (64 hex chars = 32 bytes)
openssl rand -hex 32

# Generate SESSION_COOKIE_SECRET (32+ random characters)
openssl rand -base64 32
```

---

## Running the App

| Command | Description |
|---|---|
| `npm run dev` | Start development server on port 3000 |
| `npm run build` | Build for production |
| `npm run start` | Start production server on port 3000 |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate Drizzle migration files from schema changes |
| `npm run db:migrate` | Apply migrations to the database |
| `npm run db:push` | Push schema directly to DB (no migration files; useful in dev) |
| `npm run db:seed` | Seed the admin user from `ADMIN_EMAILS` |

---

## How It Works

### Chat Flow

The chat system uses OpenAI's Responses API with MCP tool calling. Here's the end-to-end flow:

1. **User sends a message** in the chat UI.
2. **Message is added** to the in-memory chat store and (when auth is enabled) persisted to the database.
3. **OpenAI is called** with the conversation history + available MCP tools:
   - All OpenAI calls go through `POST /api/chat` server-side. Before calling the model, the server runs **input moderation**. After receiving the response, it runs **output moderation**. System instructions from an editable markdown file are injected via the `instructions` parameter.
4. **If the model returns tool calls:**
   - Each tool call is executed against the connected MCP server via `mcpClient.callTool()`.
   - UCP checkout tools get automatic metadata injection (profile URL, idempotency keys, mock buyer info).
   - Tool results are rendered as text, MCP-UI components, or UCP checkout cards.
5. **If the model returns text only**, it's rendered as markdown in the chat.

### MCP Server Connections

The app can connect to multiple MCP servers simultaneously:

1. **Admin users** see the server panel in the sidebar. Enter an MCP server URL and click **Connect**.
2. The app calls the server's `initialize` method, then `tools/list` to discover available tools.
3. Connected servers and their tools are persisted in `localStorage` across browser sessions.
4. All tools from all connected servers are aggregated and sent to OpenAI as available functions.
5. When a tool is called, the app routes the call to the correct server based on which server owns that tool.

The MCP client (`src/lib/mcp-client.ts`) manages sessions per server URL, including MCP session IDs for stateful servers.

### UCP Checkout Flow

When a UCP-compliant MCP server is connected, the AI can manage a full checkout:

1. **Browse products** — the model calls `list_products`, `get_product`, or `recommend_products`.
2. **Create checkout** — `create_checkout` with line items (product IDs as strings). The app auto-injects:
   - `meta["ucp-agent"].profile` URL
   - Mock buyer info (email, first_name, last_name)
3. **Update checkout** — `update_checkout` to add/modify buyer info or line items.
4. **Complete checkout** — `complete_checkout` with auto-generated `idempotency-key` in meta. A mock payment instrument is provided for demo purposes.
5. **Cancel checkout** — `cancel_checkout` with auto-generated idempotency key.

Checkout responses are parsed and rendered as styled cards showing status, line items, totals, and buyer info.

### Embedded Checkout Protocol (ECP)

If a UCP server supports embedded checkout (indicated by a `continue_url` and `embedded` binding in the checkout response), the app can host the payment UI in an iframe:

1. The checkout card shows an **"Embedded Checkout"** button.
2. Clicking it opens an iframe pointed at the server's `continue_url`.
3. The iframe and host communicate via JSON-RPC messages:
   - `ec.ready` — iframe signals it's loaded
   - `ec.payment.instruments_change_request` — iframe requests payment instruments (app provides a mock instrument)
   - `ec.success` — payment completed
   - `ec.error` — payment failed

See `src/components/chat/ecp-embed.tsx` for the full implementation.

### Authentication

When `NEXT_PUBLIC_AUTH_ENABLED=true`, the app uses a three-layer auth architecture:

**Layer 1 — JWT Verification (Cognito JWKS)**

1. User clicks **Login** and is redirected to the Cognito Hosted UI.
2. After login, Cognito redirects back to `/?code=...`.
3. The frontend exchanges the code for tokens (id_token, access_token, refresh_token) by calling the Cognito token endpoint.
4. Tokens are sent to `POST /api/auth/exchange`.
5. The server verifies the JWT signature against Cognito's JWKS endpoint (cached in memory).

**Layer 2 — Encrypted Token Storage (AES-256-GCM)**

- OAuth tokens are encrypted with AES-256-GCM before being stored in the `user_oauth_accounts` table.
- Each encryption uses a random 12-byte IV and produces a 16-byte authentication tag.
- Stored as a single base64 string: `IV + auth_tag + ciphertext`.
- This prevents token exposure if the database is compromised.

**Layer 3 — Session Cookie (iron-session)**

- After token exchange, an encrypted `iron-session` cookie is set containing: `userId`, `email`, `role`, `tenantId`, `isLoggedIn`.
- Cookie settings: `httpOnly`, `secure` (production only), `sameSite=lax`, 7-day expiry.
- All subsequent API calls read auth from this cookie. No JWT is sent on every request.

**User Creation:**

Users are automatically created in the database on first Cognito login — no manual seeding is needed. The exchange endpoint:
- Looks up the user by Cognito `sub` (external user ID)
- If not found, checks by email (adopts existing user)
- If still not found, creates a new user

**Admin Role:**

A user gets the `admin` role if:
- Their email is in the `ADMIN_EMAILS` environment variable, OR
- They belong to an `admin` group in Cognito

**Token Refresh:**

`POST /api/auth/refresh` decrypts the stored refresh token, calls Cognito's `REFRESH_TOKEN_AUTH` flow, and updates the stored access token.

### Guardrails & Moderation

The guardrails system has three implemented layers (with four more planned):

**1. Input Moderation** (before calling the model)
- Uses `openai.moderations.create({ model: "omni-moderation-latest" })` on the latest user message.
- If flagged, the request is blocked and a neutral refusal is returned.
- Controlled by `GUARDRAILS_INPUT_MODERATION`.

**2. Output Moderation** (before returning the response)
- Runs moderation on the assistant's text output.
- If flagged, the response is replaced with a safe refusal and any tool calls are stripped.
- Controlled by `GUARDRAILS_OUTPUT_MODERATION`.

**3. System Instructions** (model behavior shaping)
- Loaded from the editable file `src/lib/guardrails/system-instructions.md`.
- Injected as the `instructions` parameter in the OpenAI Responses API call.
- In development mode, the file is re-read on every request (no restart needed).
- In production, the file is cached after first read.

**Fail-Closed Behavior:**
- When `GUARDRAILS_FAIL_CLOSED=true` and the moderation API errors out, the request is blocked rather than allowed through.

**Customizing the System Prompt:**

Edit `src/lib/guardrails/system-instructions.md` to change the model's behavior. The default prompt scopes the assistant to shopping and checkout topics. In dev mode, changes take effect immediately without restarting the server.

See [`docs/guardrail-simple.md`](docs/guardrail-simple.md) for the full guardrails design including planned layers (scope gate, tool allowlist, domain allowlist, rate limiting).

### Chat History & Persistence

When auth is enabled:

1. A **chat session** is created in the database when the chat page loads or when the user clicks "New Chat".
2. Every user and assistant message is **shadow-persisted** — written to the DB in a non-blocking `fetch` call that silently fails if there's an error.
3. The **slide-out menu** (hamburger icon) shows up to 50 recent sessions with message previews and counts.
4. Clicking a session loads its messages from the database.
5. Sessions include metadata: `traceId`, `requestId`, `clientContext` (JSONB).

In demo mode, chat history is only kept in memory and is lost on page refresh.

---

## Key Routes

| Route | Description |
|---|---|
| `/` | Main chat interface |
| `/ucp` | UCP Compliance Center — scan MCP servers for spec compliance |
| `/admin` | Admin dashboard (redirects to `/admin/users`; requires `admin` role) |
| `/admin/users` | User management — search, toggle status |
| `/admin/sessions` | Chat session viewer — see all sessions with message counts |
| `/admin/audit` | Audit event log — filter by event type, user, date range |

---

## API Reference

### Chat

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/chat` | Required | Server-side OpenAI proxy. Accepts `{ messages, tools?, tool_choice?, model? }`. Runs input/output moderation. Returns `{ model, assistantMessage: { content, toolCalls } }`. |

### Sessions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/sessions` | Required | Create a new chat session. Returns `{ session: { id, userId, status, startedAt } }`. |
| `GET` | `/api/sessions` | Required | List current user's sessions (up to 50, most recent first). Each includes `preview` (first 100 chars) and `messageCount`. |

### Messages

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/messages` | Required | Create a message. Body: `{ sessionId, role, content, modelName?, metadata? }`. |
| `GET` | `/api/messages?sessionId=<id>` | Required | List all messages in a session. |

### Authentication

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/exchange` | None | Exchange Cognito tokens for a session cookie. Body: `{ id_token, access_token, refresh_token, expires_in }`. Verifies JWT, upserts user, encrypts/stores tokens, sets cookie. |
| `POST` | `/api/auth/refresh` | Required | Refresh the access token using the stored refresh token. |
| `POST` | `/api/auth/logout` | None | Destroy the session cookie. |
| `GET` | `/api/auth/me` | None | Returns `{ user: { id, email, role, tenantId } }` or `{ user: null }`. |

### Admin (requires `admin` role)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/users?search=&page=&limit=` | List users (paginated, searchable by email) |
| `PATCH` | `/api/admin/users/:id` | Update user `{ status?, role? }` |
| `GET` | `/api/admin/sessions?page=&limit=` | List all sessions with user email and message count |
| `GET` | `/api/admin/sessions/:id/messages` | Get all messages in a session |
| `GET` | `/api/admin/audit?eventType=&userId=&dateFrom=&dateTo=&page=&limit=` | List audit events (filtered, paginated) |

---

## Database Schema

Five tables managed by Drizzle ORM (see `src/lib/db/schema.ts`):

### `users`

| Column | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `tenantId` | text | Tenant identifier (default: `"default"`) |
| `externalUserId` | text | Cognito `sub` |
| `email` | text | Unique email address |
| `displayName` | text | Full name |
| `avatarUrl` | text | Profile picture URL |
| `role` | text | `user` or `admin` |
| `status` | text | `active`, `inactive`, or `suspended` |
| `createdAt` / `updatedAt` / `lastSeenAt` | timestamp | Lifecycle timestamps |

### `user_oauth_accounts`

Stores encrypted OAuth tokens per user. Access tokens and refresh tokens are encrypted with AES-256-GCM before storage.

### `chat_sessions`

Tracks chat session lifecycle: `active` or `ended`, with start/end timestamps and optional trace/request IDs.

### `chat_messages`

Individual messages with `role` (user/assistant/system), content, optional `contentRedacted`, `modelName`, and JSONB `metadata` for tool calls, UI resources, etc.

### `audit_events`

Security audit trail with `eventType`, `eventStatus`, `eventSource`, `payloadJson` (JSONB), `errorMessageRedacted`, and `latencyMs`. Currently logs `auth.token_exchange` events in shadow mode (non-blocking, never fails the request).

---

## UCP Compliance Center

The `/ucp` page validates MCP servers against the [UCP spec](https://ucp.dev/2026-01-23/). It performs a two-phase check:

### Phase 1 — MCP Tool Check

Connects to the MCP server and verifies all 5 required checkout tools are present:

| Tool | Required |
|---|---|
| `create_checkout` | Yes |
| `get_checkout` | Yes |
| `update_checkout` | Yes |
| `complete_checkout` | Yes |
| `cancel_checkout` | Yes |

Optional product-discovery tools (`list_products`, `get_product`, `recommend_products`) are tracked but don't affect compliance.

### Phase 2 — Profile Discovery

Fetches `GET {origin}/.well-known/ucp` and validates:

- `ucp.version` is present
- `dev.ucp.shopping` MCP service entry exists with valid endpoint, schema, and spec URLs
- All schema/spec URLs are from `https://ucp.dev` (namespace governance)
- `dev.ucp.shopping.checkout` capability is declared
- (Warning) Embedded service entry (ECP) is present
- (Warning) `signing_keys` array is present

### Compliance Verdicts

| Badge | Condition |
|---|---|
| **UCP Compliant** (green) | All 5 tools present AND profile has 0 errors |
| **Partial Compliance** (yellow) | Connected but tool check or profile has issues |
| **Connection Failed** (red) | Cannot connect to the MCP server |

### How to Use

1. Navigate to `/ucp`.
2. Paste an MCP server URL and click **Add & Scan**.
3. Results appear immediately. Click **Rescan All** to re-check.
4. Server URLs are saved in `localStorage`.

See [`docs/UCP-compliance-check.md`](docs/UCP-compliance-check.md) for the full breakdown.

---

## Admin Dashboard

Accessible at `/admin` (requires `admin` role).

### Users (`/admin/users`)

- Search users by email
- View user details: email, role, status, created date
- Toggle user status (active / inactive)
- 20 users per page with pagination

### Sessions (`/admin/sessions`)

- View all chat sessions across all users
- Shows user email, message count, timestamps
- Click a session to view its full message history
- 20 sessions per page with pagination

### Audit Log (`/admin/audit`)

- Filter by event type, user ID, date range
- Currently tracks `auth.token_exchange` events (success/failure)
- Shows event type, status, source, payload JSON, latency, timestamp
- 50 events per page with pagination

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts              # OpenAI Responses API proxy + guardrails
│   │   ├── sessions/route.ts          # Chat session CRUD (POST create, GET list)
│   │   ├── messages/route.ts          # Message CRUD (POST create, GET list by session)
│   │   ├── auth/
│   │   │   ├── exchange/route.ts      # Cognito token → session cookie exchange
│   │   │   ├── refresh/route.ts       # Refresh access token via stored refresh token
│   │   │   ├── logout/route.ts        # Destroy session cookie
│   │   │   └── me/route.ts            # Get current authenticated user
│   │   └── admin/
│   │       ├── users/route.ts         # List/update users (admin only)
│   │       ├── sessions/route.ts      # List all sessions (admin only)
│   │       └── audit/route.ts         # List audit events (admin only)
│   ├── admin/                         # Admin UI pages (users, sessions, audit)
│   ├── ucp/page.tsx                   # UCP Compliance Center
│   ├── layout.tsx                     # Root layout with AuthProvider
│   └── page.tsx                       # Main chat page
├── components/
│   ├── auth/
│   │   ├── auth-provider.tsx          # useAuth() React context + Cognito OAuth flow
│   │   ├── login-dialog.tsx           # Login prompt shown when not authenticated
│   │   └── user-menu.tsx              # User avatar dropdown (logout, admin link)
│   ├── chat/
│   │   ├── chat-container.tsx         # Orchestrates the full chat loop (messages → OpenAI → tools → render)
│   │   ├── chat-input.tsx             # Text input with send button
│   │   ├── message-bubble.tsx         # Renders text (markdown), MCP-UI resources, checkout cards
│   │   ├── checkout-card.tsx          # UCP checkout display card (status, items, totals, pay button)
│   │   ├── ecp-embed.tsx             # Embedded Checkout Protocol iframe host (JSON-RPC messaging)
│   │   ├── server-panel.tsx           # MCP server connection manager (add/remove/connect)
│   │   └── slide-out-menu.tsx         # Chat history sidebar (sessions list, new chat, user menu)
│   ├── admin/
│   │   └── admin-shell.tsx            # Admin layout wrapper with navigation
│   └── ui/                            # shadcn/ui primitives (button, dialog, scroll-area, etc.)
└── lib/
    ├── mcp-client.ts                  # MCP protocol client (connect, callTool, readResource, session mgmt)
    ├── ucp-utils.ts                   # UCP compliance checks + checkout response parsing
    ├── chat-store.ts                  # In-memory chat state (messages, loading, subscribe/notify)
    ├── render-mode-store.ts           # Toggle between "classic" and "mcp-apps" UI render modes
    ├── mock-user.ts                   # Mock user data for demo mode
    ├── utils.ts                       # Tailwind class merge utility (cn)
    ├── auth/
    │   ├── cognito.ts                 # JWT verification using jose + Cognito JWKS endpoint
    │   ├── crypto.ts                  # AES-256-GCM encrypt/decrypt for OAuth token storage
    │   └── session.ts                 # iron-session helpers (getSession, requireAuth, requireAdmin)
    ├── db/
    │   ├── index.ts                   # Lazy-initialized Neon Postgres connection (proxy pattern)
    │   ├── schema.ts                  # Drizzle ORM schema (5 tables: users, oauth, sessions, messages, audit)
    │   └── seed.ts                    # Admin user seeder (reads ADMIN_EMAILS)
    ├── guardrails/
    │   ├── index.ts                   # moderateInput(), moderateOutput(), getSystemInstructions()
    │   └── system-instructions.md     # Editable system prompt (reloaded on every request in dev)
    └── services/
        └── audit.ts                   # Shadow-mode audit event logger (non-blocking, never fails requests)
```

---

## Architecture & Design Decisions

### Dual-Mode OpenAI Calls

In **demo mode** (`NEXT_PUBLIC_AUTH_ENABLED=false`), OpenAI is called directly from the browser using the Responses API. In **auth mode**, all calls go through the `POST /api/chat` server-side proxy, which adds moderation guardrails and system instructions. Both paths produce the same normalized `LLMResponse` format.

### Lazy Database Initialization

The Neon Postgres connection uses a Proxy pattern (`src/lib/db/index.ts`) that delays the actual connection until the first database query. This means the database is never touched in demo mode, even though the schema module is imported.

### Shadow-Mode Persistence

All database writes for chat messages and audit events are **fire-and-forget** — wrapped in `.catch(() => {})` or try/catch blocks that silently swallow errors. This ensures that a database hiccup never breaks the user's chat experience. The tradeoff is that messages could occasionally be lost.

### Encrypted Token Storage

OAuth tokens are encrypted with AES-256-GCM before being stored in the database. Each encryption generates a random 12-byte IV and 16-byte auth tag. The key is a 32-byte value from `TOKEN_ENCRYPTION_KEY`. This prevents token exposure even if the database is compromised.

### MCP Session Caching

MCP server connections are cached in memory by server URL. Multiple servers can be connected concurrently, and tools from all servers are aggregated when calling OpenAI. Note: this cache is per-process and not shared across serverless instances.

### UCP Metadata Injection

The chat container automatically injects UCP-required metadata into checkout tool arguments:
- `meta["ucp-agent"].profile` URL for all checkout tools
- `meta["idempotency-key"]` for `complete_checkout` and `cancel_checkout`
- Mock buyer info for `create_checkout` and `update_checkout`

This simplifies the AI model's job — it doesn't need to know about these protocol requirements.

### Editable System Instructions

The system prompt lives in a markdown file (`src/lib/guardrails/system-instructions.md`) rather than being hardcoded. In development, it's re-read on every request. In production, it's cached. This allows operations teams to modify guardrail behavior without deploying code changes.

---

## Contributing

Contributions are welcome. Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run linting (`npm run lint`)
5. Commit and push
6. Open a pull request

## License

See the [LICENSE](../LICENSE) file in the root of the repository.
