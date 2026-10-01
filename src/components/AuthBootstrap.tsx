"use client";

import { useEffect } from "react";
import { bootstrapAuthSubscription } from "@/lib/auth";

/**
 * Mounted once near the app root. Hydrates the auth cache from Supabase on
 * first paint and keeps it in sync with sign-in / sign-out events fired by
 * other tabs or by the OAuth callback. Renders nothing.
 */
export default function AuthBootstrap() {
  useEffect(() => {
    const unsub = bootstrapAuthSubscription();
    return () => unsub();
  }, []);
  return null;
}
