# Chat Host

MCP-compatible chat interface for discovering and interacting with
[Universal Commerce Protocol (UCP)](https://ucp.dev/2026-01-23/) MCP servers.

## Features

- **MCP Server Discovery** — connect to any MCP-compatible server
- **UCP Compliance Center** — validate servers against the UCP spec at `/ucp`
- **MCP-UI Rendering** — render interactive UI components from MCP servers via `@mcp-ui/client`
- **Embedded Checkout (ECP)** — host embedded checkout flows from UCP servers
- **OpenAI Integration** — AI-powered chat with full tool-calling support
- **Auth (optional)** — AWS Cognito OAuth with iron-session cookies; can be disabled for local dev
- **Admin UI** — user management, session viewer, and audit log at `/admin`

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 3 + shadcn/ui |
| AI | OpenAI SDK (`openai` ^4) — uses Responses API |
| MCP | `@modelcontextprotocol/sdk` + `@mcp-ui/client` |
| Database | Neon Postgres (serverless) via Drizzle ORM |
| Auth | AWS Cognito JWT (`jose`), AES-256-GCM token encryption, `iron-session` cookies |
| ORM | Drizzle ORM + `drizzle-kit` for migrations |

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- OpenAI API key
- (Optional) Neon Postgres `DATABASE_URL` — required for auth and chat history
- (Optional) AWS Cognito app — required when `NEXT_PUBLIC_AUTH_ENABLED=true`

### Installation

```bash
cd chat-host
npm install
```

### Environment Variables

Create a `.env.local` file:

```bash
# ── OpenAI ──────────────────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.2            # model used by the chat API route

# ── Auth toggle ─────────────────────────────────────────────────────────────
# Set to "false" to skip login entirely (useful for local dev / demos)
NEXT_PUBLIC_AUTH_ENABLED=true

# ── Database (Neon Postgres) ─────────────────────────────────────────────────
DATABASE_URL=postgresql://...    # required when auth is enabled

# ── Session encryption ───────────────────────────────────────────────────────
SESSION_SECRET=...               # 32+ char random string for iron-session cookies
TOKEN_ENCRYPTION_KEY=...         # 32-byte hex key for AES-256-GCM token storage

# ── AWS Cognito (required when NEXT_PUBLIC_AUTH_ENABLED=true) ────────────────
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
COGNITO_REGION=us-east-1
COGNITO_ISSUER=https://cognito-idp.<region>.amazonaws.com/<user-pool-id>

NEXT_PUBLIC_COGNITO_REGION=us-east-1
NEXT_PUBLIC_COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
NEXT_PUBLIC_COGNITO_DOMAIN=your-cognito-domain-prefix   # e.g. "myapp" → myapp.auth.us-east-1.amazoncognito.com

# ── Admin access ─────────────────────────────────────────────────────────────
# Comma-separated list of emails that get the "admin" role on first login.
# Alternatively, add users to an "admin" group in Cognito.
ADMIN_EMAILS=you@example.com
```

**Notes:**
- Users are created in the database on first successful Cognito login — no manual seeding required.
- A user receives the `admin` role if their email is in `ADMIN_EMAILS` **or** they belong to a `admin` Cognito group.
- When `NEXT_PUBLIC_AUTH_ENABLED=false` a mock user is injected so the app runs without any Cognito/DB setup.

### Database setup

```bash
npm run db:generate   # generate migration files from schema changes
npm run db:migrate    # apply migrations to Neon Postgres
npm run db:push       # push schema directly (no migration files, useful in dev)
npm run db:seed       # seed the admin user defined in ADMIN_EMAILS
```

### Development

```bash
npm run dev
```

App runs at `http://localhost:3000`.

## Key Routes

| Route | Description |
|---|---|
| `/` | Main chat interface |
| `/ucp` | UCP Compliance Center — scan MCP servers for spec compliance |
| `/admin` | Admin dashboard (requires `admin` role) |
| `/admin/users` | User management |
| `/admin/sessions` | Chat session viewer |
| `/admin/audit` | Audit event log |
| `/api/chat` | Server-side OpenAI proxy (POST) |
| `/api/sessions` | Chat session persistence |
| `/api/auth/exchange` | Cognito auth-code → session cookie exchange |

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── chat/route.ts          # OpenAI Responses API proxy
│   │   ├── sessions/route.ts      # Chat session CRUD
│   │   ├── auth/                  # exchange / refresh / logout / me
│   │   └── admin/                 # admin-only data endpoints
│   ├── admin/                     # Admin UI pages
│   ├── ucp/page.tsx               # UCP Compliance Center
│   └── page.tsx                   # Main chat page
├── components/
│   ├── auth/
│   │   ├── auth-provider.tsx      # useAuth() React context
│   │   ├── login-dialog.tsx
│   │   └── user-menu.tsx
│   ├── chat/
│   │   ├── chat-container.tsx     # Orchestrates the full chat loop
│   │   ├── chat-input.tsx
│   │   ├── message-bubble.tsx     # Renders text + MCP-UI resources
│   │   ├── checkout-card.tsx      # UCP checkout display card
│   │   ├── ecp-embed.tsx          # Embedded Checkout Protocol host
│   │   └── server-panel.tsx       # MCP server connection panel
│   └── ui/                        # shadcn/ui primitives
└── lib/
    ├── mcp-client.ts              # MCP protocol client
    ├── ucp-utils.ts               # UCP compliance + profile validation
    ├── chat-store.ts              # In-memory chat state
    ├── render-mode-store.ts       # UI render mode toggle
    ├── auth/
    │   ├── cognito.ts             # JWT verification (jose + JWKS)
    │   ├── crypto.ts              # AES-256-GCM token encryption
    │   └── session.ts             # iron-session helpers
    ├── db/
    │   ├── index.ts               # Lazy-initialized Neon connection
    │   ├── schema.ts              # Drizzle schema (5 tables)
    │   └── seed.ts                # Admin user seeder
    └── services/
        └── audit.ts               # Shadow-mode audit logger
```

## Database Schema

Five tables managed by Drizzle ORM:

| Table | Purpose |
|---|---|
| `users` | App users (created on first Cognito login) |
| `user_oauth_accounts` | Encrypted Cognito tokens per user |
| `chat_sessions` | Chat session lifecycle |
| `chat_messages` | Individual messages (user / assistant / system) |
| `audit_events` | Auth and security audit trail |

## Auth Flow

1. User clicks **Login** → redirected to the Cognito Hosted UI.
2. Cognito redirects back with an auth code to `/api/auth/exchange`.
3. The exchange route verifies the JWT (via JWKS), encrypts the tokens with
   AES-256-GCM, upserts the user in Postgres, and sets an encrypted
   `iron-session` cookie.
4. All subsequent API calls read the session from the cookie.
   Middleware at `src/middleware.ts` guards `/admin/*` routes.

## UCP Compliance

The `/ucp` page checks two things for each configured MCP server:

1. **MCP Tool Check** — all 5 required checkout tools are present
   (`create_checkout`, `get_checkout`, `update_checkout`, `complete_checkout`, `cancel_checkout`).
2. **Profile Discovery** — `GET {origin}/.well-known/ucp` is valid per the UCP spec
   (correct service entries, namespace-compliant schema/spec URLs, checkout capability declared).

See [`docs/UCP-compliance-check.md`](docs/UCP-compliance-check.md) for the full breakdown.

## Audit Logging

Audit writes are shadow-mode (wrapped in try/catch, never block the request).
Currently only `auth.token_exchange` events are logged. High-volume events
(session/message lifecycle) are intentionally omitted to avoid DB growth.
See [`docs/guardrails-implementation.md`](docs/guardrails-implementation.md) for rationale.
