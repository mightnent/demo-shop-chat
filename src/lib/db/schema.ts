import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    externalUserId: text("external_user_id").notNull(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
    status: text("status", { enum: ["active", "inactive", "suspended"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("users_tenant_external_idx").on(
      table.tenantId,
      table.externalUserId
    ),
    index("users_email_idx").on(table.email),
  ]
);

export const userOauthAccounts = pgTable(
  "user_oauth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tenantId: text("tenant_id").notNull().default("default"),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenType: text("token_type"),
    scopes: text("scopes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("oauth_tenant_provider_subject_idx").on(
      table.tenantId,
      table.provider,
      table.providerSubject
    ),
  ]
);

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tenantId: text("tenant_id").notNull().default("default"),
    status: text("status", { enum: ["active", "ended"] })
      .notNull()
      .default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endedReason: text("ended_reason"),
    traceId: text("trace_id"),
    requestId: text("request_id"),
    clientContext: jsonb("client_context"),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_tenant_status_idx").on(table.tenantId, table.status),
  ]
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tenantId: text("tenant_id").notNull().default("default"),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content: text("content").notNull(),
    contentRedacted: text("content_redacted"),
    modelName: text("model_name"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    traceId: text("trace_id"),
    requestId: text("request_id"),
  },
  (table) => [
    index("messages_session_idx").on(table.sessionId),
    index("messages_tenant_created_idx").on(table.tenantId, table.createdAt),
  ]
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    userId: uuid("user_id").references(() => users.id),
    sessionId: uuid("session_id").references(() => chatSessions.id),
    eventType: text("event_type").notNull(),
    eventStatus: text("event_status"),
    eventSource: text("event_source"),
    payloadJson: jsonb("payload_json"),
    errorCode: text("error_code"),
    errorMessageRedacted: text("error_message_redacted"),
    latencyMs: integer("latency_ms"),
    traceId: text("trace_id"),
    requestId: text("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("audit_tenant_type_idx").on(table.tenantId, table.eventType),
    index("audit_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("audit_user_idx").on(table.userId),
  ]
);

export const claimsRoutes = pgTable(
  "claims_routes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: text("tenant_id").notNull().default("default"),
    routeKey: text("route_key").notNull(),
    pageUrl: text("page_url").notNull(),
    pathPrefixes: jsonb("path_prefixes").$type<string[]>().notNull(),
    keywords: jsonb("keywords").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("claims_routes_tenant_key_idx").on(table.tenantId, table.routeKey),
    index("claims_routes_tenant_updated_idx").on(table.tenantId, table.updatedAt),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type ClaimsRouteRow = typeof claimsRoutes.$inferSelect;
