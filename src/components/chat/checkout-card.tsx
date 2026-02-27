"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { UcpCheckoutData } from "@/lib/ucp-utils";
import { formatPrice } from "@/lib/ucp-utils";
import { EcpEmbed } from "./ecp-embed";
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
  onSubmitPaymentCredential?: (
    checkoutId: string,
    payload: {
      cardNumber: string;
      expiryMonth: string;
      expiryYear: string;
      cvc: string;
      cardholderName?: string;
    }
  ) => Promise<void>;
  onEcpComplete?: (checkout: UcpCheckoutData) => void;
  mockWalletEnabled?: boolean;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "warning" | "destructive" | "info" | "secondary" | "success"; icon: React.ReactNode }
> = {
  incomplete: {
    label: "Incomplete",
    variant: "warning",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
  },
  requires_escalation: {
    label: "Requires Action",
    variant: "warning",
    icon: <ExternalLink className="h-3.5 w-3.5" />,
  },
  ready_for_complete: {
    label: "Ready to Complete",
    variant: "info",
    icon: <ShoppingCart className="h-3.5 w-3.5" />,
  },
  complete_in_progress: {
    label: "Processing",
    variant: "secondary",
    icon: <Clock className="h-3.5 w-3.5" />,
  },
  completed: {
    label: "Order Placed",
    variant: "success",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
  },
  canceled: {
    label: "Canceled",
    variant: "destructive",
    icon: <XCircle className="h-3.5 w-3.5" />,
  },
};

export function CheckoutCard({
  checkout,
  onCompleteCheckout,
  onSubmitPaymentCredential,
  onEcpComplete,
  mockWalletEnabled = true,
}: CheckoutCardProps) {
  const formatCardNumber = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 19);
    return digits.replace(/(.{4})/g, "$1 ").trim();
  };

  const statusCfg = STATUS_CONFIG[checkout.status] || STATUS_CONFIG.incomplete;
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSubmittingCard, setIsSubmittingCard] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardholderName, setCardholderName] = useState("John Doe");
  const [cardNumber, setCardNumber] = useState("");
  const [expiryMonth, setExpiryMonth] = useState("");
  const [expiryYear, setExpiryYear] = useState("");
  const [cvc, setCvc] = useState("");
  const hasEmbedded = Boolean(
    checkout.ucp.services?.["dev.ucp.shopping"]?.some((svc) => svc.transport === "embedded")
  );
  const needsPaymentCredential = Boolean(
    checkout.messages?.some((msg) => msg.code === "payment_credential_required")
  );

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

  const handleSubmitCard = async () => {
    if (!onSubmitPaymentCredential) return;
    setCardError(null);

    const cardDigits = cardNumber.replace(/\D/g, "");
    const month = expiryMonth.trim();
    const year = expiryYear.trim();
    const cvv = cvc.trim();

    if (!/^\d{13,19}$/.test(cardDigits)) {
      setCardError("Enter a valid card number.");
      return;
    }
    if (!/^\d{2}$/.test(month) || Number(month) < 1 || Number(month) > 12) {
      setCardError("Enter a valid expiry month (MM).");
      return;
    }
    if (!/^\d{2,4}$/.test(year)) {
      setCardError("Enter a valid expiry year (YY or YYYY).");
      return;
    }
    if (!/^\d{3,4}$/.test(cvv)) {
      setCardError("Enter a valid CVC.");
      return;
    }

    setIsSubmittingCard(true);
    try {
      await onSubmitPaymentCredential(checkout.id, {
        cardNumber: cardDigits,
        expiryMonth: month,
        expiryYear: year,
        cvc: cvv,
        cardholderName: cardholderName.trim() || undefined,
      });
      setCardNumber("");
      setExpiryMonth("");
      setExpiryYear("");
      setCvc("");
    } catch (e) {
      setCardError(e instanceof Error ? e.message : "Failed to save card details.");
    } finally {
      setIsSubmittingCard(false);
    }
  };

  return (
    <Card className="w-full max-w-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground truncate">
          Checkout {checkout.id}
        </div>
        <Badge variant={statusCfg.variant} className="gap-1.5">
          {statusCfg.icon}
          {statusCfg.label}
        </Badge>
      </div>

      {/* Line Items */}
      <div className="px-4 sm:px-5 pb-3 space-y-1.5">
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
      <div className="px-4 sm:px-5 pb-3 border-t pt-3 space-y-1">
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
        <div className="px-4 sm:px-5 pb-3 border-t pt-3">
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
      {checkout.messages && checkout.messages.length > 0 && (
        <div className="px-4 sm:px-5 pb-3 space-y-1.5">
          {checkout.messages.map((msg, i) => {
            const msgVariant = msg.type === "error" ? "destructive" : msg.type === "warning" ? "warning" : "info";
            const bgClass = msg.type === "error" ? "bg-destructive/10" : msg.type === "warning" ? "bg-warning/10" : "bg-info/10";
            const borderClass = msg.type === "error" ? "border-destructive/20" : msg.type === "warning" ? "border-warning/20" : "border-info/20";
            const textClass = msg.type === "error" ? "text-destructive" : msg.type === "warning" ? "text-warning" : "text-info";

            return (
              <div
                key={i}
                className={`text-xs p-2 rounded border ${bgClass} ${borderClass} ${textClass}`}
              >
                <span className="font-medium">[{msg.code}]</span> {msg.content}
                {msg.severity && (
                  <span className="ml-1 opacity-60">({msg.severity})</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!hasEmbedded &&
        !mockWalletEnabled &&
        needsPaymentCredential &&
        onSubmitPaymentCredential && (
          <div className="px-4 sm:px-5 py-3 border-t bg-muted/20 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Add Card Details
            </div>
            <Input
              value={cardholderName}
              onChange={(e) => setCardholderName(e.target.value)}
              placeholder="Cardholder name"
              autoComplete="cc-name"
            />
            <Input
              value={cardNumber}
              onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
              placeholder="Card number"
              inputMode="numeric"
              autoComplete="cc-number"
              maxLength={23}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={expiryMonth}
                onChange={(e) => setExpiryMonth(e.target.value)}
                placeholder="MM"
                inputMode="numeric"
                autoComplete="cc-exp-month"
              />
              <Input
                value={expiryYear}
                onChange={(e) => setExpiryYear(e.target.value)}
                placeholder="YY"
                inputMode="numeric"
                autoComplete="cc-exp-year"
              />
            </div>
            <Input
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
              placeholder="CVC"
              inputMode="numeric"
              autoComplete="cc-csc"
            />
            {cardError && (
              <div className="text-xs text-destructive">{cardError}</div>
            )}
            <Button
              onClick={handleSubmitCard}
              disabled={isSubmittingCard}
              className="w-full"
            >
              {isSubmittingCard ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving Card...
                </>
              ) : (
                "Save Card and Enable Mock Wallet"
              )}
            </Button>
            <p className="text-[10px] text-center text-muted-foreground">
              Demo only: card is tokenized locally in ChatHost and never sent as raw PAN to AgentPayCore.
            </p>
          </div>
        )}

      {/* Order Confirmation */}
      {checkout.order && (
        <div className="px-4 sm:px-5 py-3 bg-success/10 border-t border-success/20">
          <div className="text-sm font-semibold text-success">
            Order #{checkout.order.id} confirmed
          </div>
          {checkout.order.permalink_url && (
            <a
              href={checkout.order.permalink_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-success underline hover:text-success/80"
            >
              View order details
            </a>
          )}
        </div>
      )}

      {/* Pay Now Button - shown when ready_for_complete and no embedded checkout */}
      {checkout.status === "ready_for_complete" && onCompleteCheckout && !hasEmbedded && (
        <div className="px-4 sm:px-5 py-3 border-t bg-info/5">
          <Button
            onClick={handlePayNow}
            disabled={isProcessing}
            className="w-full bg-info hover:bg-info/90 text-info-foreground font-medium"
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
          <div className="px-4 sm:px-5 py-2 border-t">
            <a
              href={checkout.continue_url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-info underline flex items-center gap-1 hover:text-info/80"
            >
              <ExternalLink className="h-3 w-3" />
              Continue in browser
            </a>
          </div>
        )}

      {hasEmbedded && <EcpEmbed checkout={checkout} onComplete={onEcpComplete} />}
    </Card>
  );
}
