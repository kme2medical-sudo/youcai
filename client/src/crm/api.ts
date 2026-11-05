import { useCallback, useEffect, useRef, useState } from "react";

let csrfToken: string | undefined;
export function setCsrfToken(token?: string) {
  csrfToken = token;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: "include",
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(
      "Unable to connect. Check your connection and try again.",
      0
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (
      (response.status === 401 || response.status === 403) &&
      !path.startsWith("/auth/")
    )
      window.dispatchEvent(new Event("youcai:session-refresh"));
    const message =
      typeof data?.error === "string"
        ? data.error
        : (data?.error?.message ?? data?.message);
    const fieldMessages = Array.isArray(data?.errors)
      ? data.errors
          .filter(
            (item: unknown): item is { field: string; message: string } =>
              !!item &&
              typeof item === "object" &&
              typeof (item as { field?: unknown }).field === "string" &&
              typeof (item as { message?: unknown }).message === "string"
          )
          .map(
            (item: { field: string; message: string }) =>
              `${item.field.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase())}: ${item.message}`
          )
          .join(". ")
      : "";
    throw new ApiError(
      fieldMessages ||
        message ||
        (response.status === 404
          ? "This record could not be found."
          : "The request could not be completed. Please try again."),
      response.status,
      data?.code
    );
  }
  if (response.status !== 204 && data === null)
    throw new ApiError(
      "The server returned an unexpected response. Please try again.",
      response.status
    );
  return data as T;
}
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const currentPath = useRef(path);
  const reload = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    currentPath.current = path;
    if (!path) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setError(null);
    api<T>(path, { signal: controller.signal })
      .then(value => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch(e => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [path, revision]);
  return {
    data: currentPath.current === path ? data : null,
    loading: currentPath.current !== path || loading,
    error,
    reload,
  };
}
