"use client";

import React, { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ClaimsRouteRow {
  id: string;
  key: string;
  pageUrl: string;
  keywords: string[];
  pathPrefixes: string[];
  updatedAt: string;
}

interface RouteFormState {
  key: string;
  pageUrl: string;
  keywords: string;
  pathPrefixes: string;
}

const EMPTY_FORM: RouteFormState = {
  key: "",
  pageUrl: "",
  keywords: "",
  pathPrefixes: "",
};

function toCsv(values: string[]): string {
  return values.join(", ");
}

export default function AdminClaimsRoutesPage() {
  const [routes, setRoutes] = useState<ClaimsRouteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<RouteFormState>(EMPTY_FORM);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RouteFormState>(EMPTY_FORM);

  const fetchRoutes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/claims-routes");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch routes");
      }
      setRoutes(data.routes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch routes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRoutes();
  }, []);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/claims-routes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create route");
      }
      setCreateForm(EMPTY_FORM);
      await fetchRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create route");
    } finally {
      setSubmitting(false);
    }
  };

  const beginEdit = (route: ClaimsRouteRow) => {
    setEditingRouteId(route.id);
    setEditForm({
      key: route.key,
      pageUrl: route.pageUrl,
      keywords: toCsv(route.keywords),
      pathPrefixes: toCsv(route.pathPrefixes),
    });
  };

  const handleSaveEdit = async (id: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/claims-routes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update route");
      }
      setEditingRouteId(null);
      setEditForm(EMPTY_FORM);
      await fetchRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update route");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this claims route?")) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/claims-routes/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete route");
      }
      if (editingRouteId === id) {
        setEditingRouteId(null);
        setEditForm(EMPTY_FORM);
      }
      await fetchRoutes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete route");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Claims Routes</h1>
          <p className="text-sm text-muted-foreground">
            Configure route URLs and keywords used by the chat assistant.
          </p>
        </div>
        <span className="text-sm text-muted-foreground">{routes.length} total</span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={handleCreate} className="border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="text-sm font-medium">Add Claims Route</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <Input
            placeholder="Key (e.g. motor)"
            value={createForm.key}
            onChange={(event) =>
              setCreateForm((prev) => ({ ...prev, key: event.target.value }))
            }
          />
          <Input
            placeholder="Page URL"
            value={createForm.pageUrl}
            onChange={(event) =>
              setCreateForm((prev) => ({ ...prev, pageUrl: event.target.value }))
            }
          />
          <Input
            placeholder="Keywords (comma/newline separated)"
            value={createForm.keywords}
            onChange={(event) =>
              setCreateForm((prev) => ({ ...prev, keywords: event.target.value }))
            }
          />
          <Input
            placeholder="Path prefixes (optional, comma/newline separated)"
            value={createForm.pathPrefixes}
            onChange={(event) =>
              setCreateForm((prev) => ({ ...prev, pathPrefixes: event.target.value }))
            }
          />
        </div>
        <div>
          <Button type="submit" disabled={submitting}>
            Add Route
          </Button>
        </div>
      </form>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">Key</th>
              <th className="text-left p-3 font-medium">URL</th>
              <th className="text-left p-3 font-medium">Keywords</th>
              <th className="text-left p-3 font-medium">Path Prefixes</th>
              <th className="text-left p-3 font-medium">Updated</th>
              <th className="text-left p-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : routes.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No claims routes found
                </td>
              </tr>
            ) : (
              routes.map((route) => {
                const isEditing = editingRouteId === route.id;
                return (
                  <tr key={route.id} className="border-b last:border-0 align-top">
                    <td className="p-3 min-w-40">
                      {isEditing ? (
                        <Input
                          value={editForm.key}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, key: event.target.value }))
                          }
                        />
                      ) : (
                        <span className="font-mono text-xs">{route.key}</span>
                      )}
                    </td>
                    <td className="p-3 min-w-96">
                      {isEditing ? (
                        <Input
                          value={editForm.pageUrl}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, pageUrl: event.target.value }))
                          }
                        />
                      ) : (
                        <a
                          href={route.pageUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline break-all"
                        >
                          {route.pageUrl}
                        </a>
                      )}
                    </td>
                    <td className="p-3 min-w-80">
                      {isEditing ? (
                        <Input
                          value={editForm.keywords}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, keywords: event.target.value }))
                          }
                        />
                      ) : (
                        <span className="text-muted-foreground">{toCsv(route.keywords)}</span>
                      )}
                    </td>
                    <td className="p-3 min-w-80">
                      {isEditing ? (
                        <Input
                          value={editForm.pathPrefixes}
                          onChange={(event) =>
                            setEditForm((prev) => ({ ...prev, pathPrefixes: event.target.value }))
                          }
                        />
                      ) : (
                        <span className="text-muted-foreground">{toCsv(route.pathPrefixes)}</span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground whitespace-nowrap">
                      {new Date(route.updatedAt).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <Button
                              size="sm"
                              onClick={() => void handleSaveEdit(route.id)}
                              disabled={submitting}
                            >
                              Save
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setEditingRouteId(null);
                                setEditForm(EMPTY_FORM);
                              }}
                              disabled={submitting}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => beginEdit(route)}
                            disabled={submitting}
                          >
                            Edit
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void handleDelete(route.id)}
                          disabled={submitting}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
