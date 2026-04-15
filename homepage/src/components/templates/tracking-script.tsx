"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    __trackEvent?: (eventType: string, eventData?: Record<string, unknown>) => void;
  }
}

interface TrackingScriptProps {
  code: string;
}

export default function TrackingScript({ code }: TrackingScriptProps) {
  useEffect(() => {
    // Track page visit
    fetch(`/api/public/visit/${code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }).catch(() => {
      // Silently fail - tracking should not break the page
    });

    // Expose event tracking function globally
    window.__trackEvent = (
      eventType: string,
      eventData?: Record<string, unknown>
    ) => {
      fetch(`/api/public/event/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventType, eventData }),
      }).catch(() => {
        // Silently fail
      });
    };

    return () => {
      delete window.__trackEvent;
    };
  }, [code]);

  return null;
}
