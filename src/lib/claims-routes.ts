import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { claimsRoutes } from "@/lib/db/schema";

type ClaimsRouteSeed = {
  key: string;
  pageUrl: string;
  pathPrefixes: string[];
  keywords: string[];
};

export type ClaimsRoute = {
  id: string;
  key: string;
  pageUrl: string;
  pathPrefixes: string[];
  keywords: string[];
  updatedAt: Date;
};

type ClaimsRoutePayload = {
  key?: unknown;
  pageUrl?: unknown;
  pathPrefixes?: unknown;
  keywords?: unknown;
};

const ROUTES_CACHE_TTL_MS = 60_000;

const seededTenants = new Set<string>();
const cachedRoutesByTenant = new Map<string, ClaimsRoute[]>();
const cacheExpiryByTenant = new Map<string, number>();

const DEFAULT_CLAIMS_ROUTES: ClaimsRouteSeed[] = [
  {
    key: "motor",
    pageUrl: "https://www.income.com.sg/claims/motor-insurance",
    pathPrefixes: ["/claims/motor-insurance", "/claims/reporting-centres"],
    keywords: [
      "motor",
      "car",
      "vehicle",
      "accident",
      "theft",
      "stolen",
      "windscreen",
      "private settlement",
      "reporting centre",
    ],
  },
  {
    key: "travel",
    pageUrl: "https://www.income.com.sg/claims/travel-claims",
    pathPrefixes: ["/claims/travel-claims"],
    keywords: ["travel", "trip", "flight", "baggage", "overseas"],
  },
  {
    key: "home",
    pageUrl: "https://www.income.com.sg/claims/home-insurance-claims",
    pathPrefixes: ["/claims/home-insurance-claims"],
    keywords: ["home", "house", "fire", "flood", "renovation"],
  },
  {
    key: "domestic-helper",
    pageUrl: "https://www.income.com.sg/claims/domestic-helper-insurance-claims",
    pathPrefixes: ["/claims/domestic-helper-insurance-claims"],
    keywords: ["domestic helper", "maid", "helper", "fdw"],
  },
  {
    key: "property-liability",
    pageUrl: "https://www.income.com.sg/claims/property-liability-claim",
    pathPrefixes: ["/claims/property-liability-claim"],
    keywords: ["property liability", "liability", "third party", "injury", "damage"],
  },
];

export class ClaimsRouteValidationError extends Error {}

function normalizeRouteKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toUniqueList(values: string[]): string[] {
  return Array.from(new Set(values));
}

function normalizePathPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

function parseTextList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePageUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ClaimsRouteValidationError("pageUrl is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ClaimsRouteValidationError("pageUrl must be a valid absolute URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ClaimsRouteValidationError("pageUrl must use http or https");
  }

  return parsed.toString();
}

function derivePathPrefixesFromPageUrl(pageUrl: string): string[] {
  try {
    const parsed = new URL(pageUrl);
    if (parsed.pathname === "/" || !parsed.pathname) return [];
    return [normalizePathPrefix(parsed.pathname)];
  } catch {
    return [];
  }
}

function mapDbRowToClaimsRoute(row: typeof claimsRoutes.$inferSelect): ClaimsRoute {
  return {
    id: row.id,
    key: row.routeKey,
    pageUrl: row.pageUrl,
    pathPrefixes: coerceStringArray(row.pathPrefixes),
    keywords: coerceStringArray(row.keywords),
    updatedAt: row.updatedAt,
  };
}

async function ensureDefaultRoutesSeeded(tenantId: string): Promise<void> {
  if (seededTenants.has(tenantId)) return;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(claimsRoutes)
    .where(eq(claimsRoutes.tenantId, tenantId));

  if (Number(count) === 0) {
    await db
      .insert(claimsRoutes)
      .values(
        DEFAULT_CLAIMS_ROUTES.map((route) => ({
          tenantId,
          routeKey: route.key,
          pageUrl: route.pageUrl,
          pathPrefixes: route.pathPrefixes,
          keywords: route.keywords,
        }))
      )
      .onConflictDoNothing();
  }

  seededTenants.add(tenantId);
}

function getFallbackRoutes(): ClaimsRoute[] {
  const now = new Date();
  return DEFAULT_CLAIMS_ROUTES.map((route) => ({
    id: `default-${route.key}`,
    key: route.key,
    pageUrl: route.pageUrl,
    pathPrefixes: route.pathPrefixes,
    keywords: route.keywords,
    updatedAt: now,
  }));
}

export function invalidateClaimsRoutesCache(tenantId = "default"): void {
  cachedRoutesByTenant.delete(tenantId);
  cacheExpiryByTenant.delete(tenantId);
}

export function parseClaimsRoutePayload(payload: ClaimsRoutePayload): ClaimsRouteSeed {
  if (typeof payload.key !== "string" || !payload.key.trim()) {
    throw new ClaimsRouteValidationError("key is required");
  }

  const key = normalizeRouteKey(payload.key);
  if (!key) {
    throw new ClaimsRouteValidationError("key must include letters or numbers");
  }

  const pageUrl = parsePageUrl(payload.pageUrl);
  const keywords = toUniqueList(
    parseTextList(payload.keywords).map((item) => item.toLowerCase())
  );
  if (keywords.length === 0) {
    throw new ClaimsRouteValidationError("keywords must contain at least one keyword");
  }

  const parsedPrefixes = parseTextList(payload.pathPrefixes).map(normalizePathPrefix);
  const pathPrefixes = toUniqueList(
    parsedPrefixes.length > 0 ? parsedPrefixes : derivePathPrefixesFromPageUrl(pageUrl)
  );
  if (pathPrefixes.length === 0) {
    throw new ClaimsRouteValidationError(
      "pathPrefixes cannot be empty and could not be derived from pageUrl"
    );
  }

  return { key, pageUrl, keywords, pathPrefixes };
}

export async function listClaimsRoutes(tenantId = "default"): Promise<ClaimsRoute[]> {
  try {
    await ensureDefaultRoutesSeeded(tenantId);
    const rows = await db
      .select()
      .from(claimsRoutes)
      .where(eq(claimsRoutes.tenantId, tenantId))
      .orderBy(asc(claimsRoutes.routeKey));

    if (rows.length === 0) return getFallbackRoutes();
    return rows.map(mapDbRowToClaimsRoute);
  } catch (error) {
    console.error("[claims-routes] list failed, using defaults", error);
    return getFallbackRoutes();
  }
}

export async function listClaimsRoutesCached(tenantId = "default"): Promise<ClaimsRoute[]> {
  const now = Date.now();
  const cachedRoutes = cachedRoutesByTenant.get(tenantId);
  const cachedExpiry = cacheExpiryByTenant.get(tenantId) ?? 0;
  if (cachedRoutes && cachedExpiry > now) {
    return cachedRoutes;
  }

  const routes = await listClaimsRoutes(tenantId);
  cachedRoutesByTenant.set(tenantId, routes);
  cacheExpiryByTenant.set(tenantId, now + ROUTES_CACHE_TTL_MS);
  return routes;
}

export async function createClaimsRoute(
  payload: ClaimsRoutePayload,
  tenantId = "default"
): Promise<ClaimsRoute> {
  const parsed = parseClaimsRoutePayload(payload);
  const [row] = await db
    .insert(claimsRoutes)
    .values({
      tenantId,
      routeKey: parsed.key,
      pageUrl: parsed.pageUrl,
      pathPrefixes: parsed.pathPrefixes,
      keywords: parsed.keywords,
    })
    .returning();

  invalidateClaimsRoutesCache(tenantId);
  return mapDbRowToClaimsRoute(row);
}

export async function updateClaimsRoute(
  id: string,
  payload: ClaimsRoutePayload,
  tenantId = "default"
): Promise<ClaimsRoute | null> {
  const [existing] = await db
    .select()
    .from(claimsRoutes)
    .where(and(eq(claimsRoutes.id, id), eq(claimsRoutes.tenantId, tenantId)))
    .limit(1);

  if (!existing) return null;

  const merged: ClaimsRoutePayload = {
    key: payload.key ?? existing.routeKey,
    pageUrl: payload.pageUrl ?? existing.pageUrl,
    keywords: payload.keywords ?? coerceStringArray(existing.keywords),
    pathPrefixes: payload.pathPrefixes ?? coerceStringArray(existing.pathPrefixes),
  };
  const parsed = parseClaimsRoutePayload(merged);

  const [updated] = await db
    .update(claimsRoutes)
    .set({
      routeKey: parsed.key,
      pageUrl: parsed.pageUrl,
      pathPrefixes: parsed.pathPrefixes,
      keywords: parsed.keywords,
      updatedAt: new Date(),
    })
    .where(and(eq(claimsRoutes.id, id), eq(claimsRoutes.tenantId, tenantId)))
    .returning();

  invalidateClaimsRoutesCache(tenantId);
  return mapDbRowToClaimsRoute(updated);
}

export async function deleteClaimsRoute(
  id: string,
  tenantId = "default"
): Promise<boolean> {
  const deleted = await db
    .delete(claimsRoutes)
    .where(and(eq(claimsRoutes.id, id), eq(claimsRoutes.tenantId, tenantId)))
    .returning({ id: claimsRoutes.id });

  if (deleted.length === 0) return false;
  invalidateClaimsRoutesCache(tenantId);
  return true;
}
