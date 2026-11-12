"use client";

// Q1a: error boundary for the (admin) group (keeps its layout).
import { useEffect } from "react";
import ErrorState from "@/components/ErrorState/ErrorState";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <ErrorState kind="error" onRetry={reset} digest={error.digest} homeHref="/admin/dashboard" />;
}
