"use client";

import { useCallback, useEffect, useState } from "react";

export class HarborError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function harborFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("x-harbor-request", "1");
  if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let data: { error?: string } | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as { error?: string };
    } catch {
      throw new HarborError(response.status, "Harbor returned an unexpected response.");
    }
  }
  if (!response.ok) {
    throw new HarborError(response.status, data?.error || "Request failed.");
  }
  return data as T;
}

export function usePoll<T>(url: string | null, ms = 2000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<HarborError | null>(null);
  const [loading, setLoading] = useState(Boolean(url));

  const reload = useCallback(() => {
    if (!url) return Promise.resolve();
    return harborFetch<T>(url).then(
      (next) => {
        setData(next);
        setError(null);
        setLoading(false);
      },
      (caught: unknown) => {
        setError(caught instanceof HarborError ? caught : new HarborError(0, "Could not reach Harbor."));
        setLoading(false);
      },
    );
  }, [url]);

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    const pull = () => {
      void harborFetch<T>(url).then(
        (next) => {
          if (cancelled) return;
          setData(next);
          setError(null);
          setLoading(false);
        },
        (caught: unknown) => {
          if (cancelled) return;
          setError(caught instanceof HarborError ? caught : new HarborError(0, "Could not reach Harbor."));
          setLoading(false);
        },
      );
    };
    pull();
    if (ms <= 0) return () => {
      cancelled = true;
    };
    const timer = setInterval(pull, ms);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [url, ms]);

  return { data, error, loading, reload, setData };
}
