"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { UcpCheckoutData } from "@/lib/ucp-utils";
import { formatPrice } from "@/lib/ucp-utils";
import {
  ShoppingCart,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ExternalLink,
  CreditCard,
  Loader2,
} from "lucide-react";

interface CheckoutCardProps {
  checkout: UcpCheckoutData;
  onCompleteCheckout?: (checkoutId: string) => Promise<void>;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string; icon: React.ReactNode }
> = {
  incomplete: {
    label: "Incomplete",
    className: "text-yellow-700 bg-yellow-50 border-yellow-200",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  requires_escalation: {
    label: "Requires Action",
    className: "text-orange-700 bg-orange-50 border-orange-200",
    icon: <ExternalLink className="h-3.5 w-3.5" />,
  },
  ready_for_complete: {
    label: "Ready to Complete",
    className: "text-blue-700 bg-blue-50 border-blue-200",
    icon: <ShoppingCart className="h-3.5 w-3.5" />,
  },
  complete_in_progress: {
    label: "Processing",
    className: "text-purple-700 bg-purple-50 border-purple-200",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  completed: {
    label: "Order Placed",
    className: "text-green-700 bg-green-50 border-green-200",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  canceled: {
    label: "Canceled",
    className: "text-red-700 bg-red-50 border-red-200",
    icon: <XCircle className="h-3.5 w-3.5" />,
  },
};

export function CheckoutCard({ checkout, onCompleteCheckout }: CheckoutCardProps) {
  const statusCfg = STATUS_CONFIG[checkout.status] || STATUS_CONFIG.incomplete;
  const [isProcessing, setIsProcessing] = useState(false);

  const handlePayNow = async () => {
    if (!onCompleteCheckout) return;
    setIsProcessing(true);
    // Artificial delay to simulate payment processing
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      await onCompleteCheckout(checkout.id);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Card className="w-full max-w-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-foreground truncate">
          Checkout {checkout.id}
        </div>
        <span
          className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-medium ${statusCfg.className}`}
        >
          {statusCfg.icon}
          {statusCfg.label}
        </span>
      </div>

      {/* Line Items */}
      <div className="px-5 pb-3 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Items
        </div>
        {checkout.line_items.map((li) => (
          <div
            key={li.id}
            className="flex justify-between items-center text-sm"
          >
            <span className="text-foreground">
              {li.item.title || li.item.id}{" "}
              {li.quantity > 1 && (
                <span className="text-muted-foreground">x{li.quantity}</span>
              )}
            </span>
            <span className="font-medium text-foreground">
              {li.item.price != null
                ? formatPrice(li.item.price * li.quantity, checkout.currency)
                : "--"}
            </span>
          </div>
        ))}
      </div>

      {/* Totals */}
      <div className="px-5 pb-3 border-t pt-3 space-y-1">
        {checkout.totals.map((t, i) => {
          const isTotal = t.type === "total";
          return (
            <div
              key={i}
              className={`flex justify-between text-sm ${
                isTotal
                  ? "font-bold text-foreground pt-1"
                  : "text-muted-foreground"
              }`}
            >
              <span>
                {t.display_text ||
                  t.type.charAt(0).toUpperCase() + t.type.slice(1)}
              </span>
              <span>{formatPrice(t.amount, checkout.currency)}</span>
            </div>
          );
        })}
      </div>

      {/* Buyer Info */}
      {checkout.buyer?.email && (
        <div className="px-5 pb-3 border-t pt-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Buyer
          </div>
          <div className="text-sm text-foreground">
            {checkout.buyer.first_name} {checkout.buyer.last_name}
          </div>
          <div className="text-xs text-muted-foreground">
            {checkout.buyer.email}
          </div>
        </div>
      )}

      {/* Messages */}
      {checkout.messages.length > 0 && (
        <div className="px-5 pb-3 space-y-1.5">
          {checkout.messages.map((msg, i) => (
            <div
              key={i}
              className={`text-xs p-2 rounded border ${
                msg.type === "error"
                  ? "bg-red-50 border-red-200 text-red-700"
                  : msg.type === "warning"
                  ? "bg-yellow-50 border-yellow-200 text-yellow-700"
                  : "bg-blue-50 border-blue-200 text-blue-700"
              }`}
            >
              <span className="font-medium">[{msg.code}]</span> {msg.content}
              {msg.severity && (
                <span className="ml-1 opacity-60">({msg.severity})</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Order Confirmation */}
      {checkout.order && (
        <div className="px-5 py-3 bg-green-50 border-t border-green-200">
          <div className="text-sm font-semibold text-green-800">
            Order #{checkout.order.id} confirmed
          </div>
          {checkout.order.permalink_url && (
            <a
              href={checkout.order.permalink_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-green-700 underline"
            >
              View order details
            </a>
          )}
        </div>
      )}

      {/* Pay Now Button - shown when ready_for_complete */}
      {checkout.status === "ready_for_complete" && onCompleteCheckout && (
        <div className="px-5 py-3 border-t bg-gradient-to-r from-blue-50 to-indigo-50">
          <Button
            onClick={handlePayNow}
            disabled={isProcessing}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-medium"
          >
            {isProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing Payment...
              </>
            ) : (
              <>
                <CreditCard className="h-4 w-4 mr-2" />
                Pay Now (Mock)
              </>
            )}
          </Button>
          <p className="text-[10px] text-center text-muted-foreground mt-2">
            Demo: This simulates a payment flow
          </p>
        </div>
      )}

      {/* Continue URL - fallback for escalation or if no handler */}
      {checkout.continue_url &&
        checkout.status !== "completed" &&
        checkout.status !== "canceled" &&
        (checkout.status === "requires_escalation" || !onCompleteCheckout) && (
          <div className="px-5 py-2 border-t">
            <a
              href={checkout.continue_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-600 underline flex items-center gap-1 hover:text-blue-800"
            >
              <ExternalLink className="h-3 w-3" />
              Continue in browser
            </a>
          </div>
        )}
    </Card>
  );
}
