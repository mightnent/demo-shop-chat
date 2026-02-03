"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { UcpCheckoutData } from "@/lib/ucp-utils";

interface EcpEmbedProps {
  checkout: UcpCheckoutData;
  onComplete?: (checkout: UcpCheckoutData) => void;
}

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
};

const MOCK_INSTRUMENT = {
  id: "payment_instrument_mock",
  handler_id: "mock_handler_1",
  type: "token",
  selected: true,
  display: {
    brand: "visa",
    expiry_month: 12,
    expiry_year: 2026,
    last_digits: "1111",
    description: "Visa •••• 1111",
  },
};

export function EcpEmbed({ checkout, onComplete }: EcpEmbedProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<Record<string, unknown> | null>(null);

  const embeddedBinding = useMemo(() => {
    const services = checkout.ucp.services?.["dev.ucp.shopping"] || [];
    return services.find((svc) => svc.transport === "embedded");
  }, [checkout.ucp.services]);

  const delegateList = useMemo(() => {
    const delegate = (embeddedBinding?.config?.delegate as string[]) || [];
    return delegate.join(",");
  }, [embeddedBinding]);

  const iframeSrc = useMemo(() => {
    if (!checkout.continue_url) return "";
    const url = new URL(checkout.continue_url);
    url.searchParams.set("ec_version", checkout.ucp.version);
    if (delegateList) {
      url.searchParams.set("ec_delegate", delegateList);
    }
    return url.toString();
  }, [checkout.continue_url, checkout.ucp.version, delegateList]);

  const allowedOrigin = useMemo(() => {
    try {
      return checkout.continue_url ? new URL(checkout.continue_url).origin : "*";
    } catch {
      return "*";
    }
  }, [checkout.continue_url]);

  useEffect(() => {
    if (!iframeRef.current) return;
    const onMessage = async (event: MessageEvent) => {
      if (allowedOrigin !== "*" && event.origin !== allowedOrigin) return;
      const msg = event.data as JsonRpcRequest;
      if (!msg || msg.jsonrpc !== "2.0" || !msg.method) return;

      if (msg.method === "ec.ready") {
        const response: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {},
        };
        iframeRef.current?.contentWindow?.postMessage(response, allowedOrigin);
        return;
      }

      if (msg.method === "ec.payment.instruments_change_request") {
        const ok = window.confirm("Select a payment method? (Mock UI)");
        if (!ok) {
          const response: JsonRpcResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: "abort_error", message: "User canceled payment selection." },
          };
          iframeRef.current?.contentWindow?.postMessage(response, allowedOrigin);
          return;
        }
        setSelectedInstrument(MOCK_INSTRUMENT);
        const response: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            checkout: {
              payment: {
                instruments: [MOCK_INSTRUMENT],
              },
            },
          },
        };
        iframeRef.current?.contentWindow?.postMessage(response, allowedOrigin);
        return;
      }

      if (msg.method === "ec.payment.credential_request") {
        const ok = window.confirm("Authorize payment? (Mock UI)");
        if (!ok) {
          const response: JsonRpcResponse = {
            jsonrpc: "2.0",
            id: msg.id,
            error: { code: "abort_error", message: "User canceled payment authorization." },
          };
          iframeRef.current?.contentWindow?.postMessage(response, allowedOrigin);
          return;
        }

        const instrumentWithCredential = {
          ...(selectedInstrument || MOCK_INSTRUMENT),
          selected: true,
          credential: { type: "mock_token", token: "tok_demo" },
        };

        const response: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            checkout: {
              payment: {
                instruments: [instrumentWithCredential],
              },
            },
          },
        };
        iframeRef.current?.contentWindow?.postMessage(response, allowedOrigin);
        return;
      }

      if (msg.method === "ec.start" || msg.method === "ec.complete") {
        setLastEvent(msg.method);
        if (msg.method === "ec.complete") {
          const completed = (msg as any).params?.checkout as UcpCheckoutData | undefined;
          if (completed) {
            onComplete?.(completed);
          }
        }
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [allowedOrigin, selectedInstrument, onComplete]);

  if (
    !checkout.continue_url ||
    !embeddedBinding ||
    checkout.status === "completed" ||
    checkout.status === "canceled"
  ) {
    return null;
  }

  return (
    <div className="border-t px-5 py-4 bg-muted/10">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Embedded Checkout (ECP)
      </div>
      <div className="text-xs text-muted-foreground mb-2">
        {lastEvent ? `Last event: ${lastEvent}` : "Waiting for embedded checkout..."}
      </div>
      <iframe
        ref={iframeRef}
        title="Embedded Checkout"
        src={iframeSrc}
        className="w-full rounded border bg-white"
        style={{ minHeight: 480 }}
      />
    </div>
  );
}
