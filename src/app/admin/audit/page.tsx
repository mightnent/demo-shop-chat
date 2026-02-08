"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronRight } from "lucide-react";

const EVENT_TYPES = [
  "",
  "auth.token_exchange",
];

interface AuditRow {
  id: string;
  eventType: string;
  eventStatus: string | null;
  eventSource: string | null;
  userId: string | null;
  sessionId: string | null;
  payloadJson: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessageRedacted: string | null;
  latencyMs: number | null;
  createdAt: string;
}

export default function AdminAuditPage() {
  const [events, setEvents] = useState<AuditRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const limit = 50;

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (eventType) params.set("eventType", eventType);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/audit?${params}`);
      const data = await res.json();
      setEvents(data.events || []);
      setTotal(data.total || 0);
    } catch {
      console.error("Failed to fetch audit events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [page]);

  const handleFilter = () => {
    setPage(1);
    fetchEvents();
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Audit Log</h1>
        <span className="text-sm text-muted-foreground">{total} events</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">All event types</option>
          {EVENT_TYPES.filter(Boolean).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="w-40"
          placeholder="From"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="w-40"
          placeholder="To"
        />
        <Button variant="outline" onClick={handleFilter}>
          Filter
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="w-8 p-3"></th>
              <th className="text-left p-3 font-medium">Event</th>
              <th className="text-left p-3 font-medium">Status</th>
              <th className="text-left p-3 font-medium">Source</th>
              <th className="text-left p-3 font-medium">Latency</th>
              <th className="text-left p-3 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  No audit events found
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <React.Fragment key={event.id}>
                  <tr
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/30"
                    onClick={() =>
                      setExpandedId(
                        expandedId === event.id ? null : event.id
                      )
                    }
                  >
                    <td className="p-3">
                      {event.payloadJson || event.errorMessageRedacted ? (
                        expandedId === event.id ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRight className="h-3 w-3" />
                        )
                      ) : null}
                    </td>
                    <td className="p-3 font-mono text-xs">{event.eventType}</td>
                    <td className="p-3">
                      {event.eventStatus && (
                        <span
                          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            event.eventStatus === "success"
                              ? "bg-green-100 text-green-700"
                              : event.eventStatus === "error"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {event.eventStatus}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {event.eventSource || "-"}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {event.latencyMs != null ? `${event.latencyMs}ms` : "-"}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                  </tr>
                  {expandedId === event.id && (
                    <tr className="border-b bg-muted/10">
                      <td colSpan={6} className="p-4">
                        {event.errorMessageRedacted && (
                          <div className="mb-2">
                            <span className="text-xs font-medium text-red-600">
                              Error:{" "}
                            </span>
                            <span className="text-xs">
                              {event.errorMessageRedacted}
                            </span>
                          </div>
                        )}
                        {event.payloadJson && (
                          <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-48">
                            {JSON.stringify(event.payloadJson, null, 2)}
                          </pre>
                        )}
                        <div className="mt-2 text-xs text-muted-foreground space-x-4">
                          {event.userId && <span>User: {event.userId}</span>}
                          {event.sessionId && (
                            <span>Session: {event.sessionId}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
