import JSONBig from "json-bigint";

export const DEFAULT_PRODUCTION_API_URL = "https://env-opentask.user.cloudjkt02.com";
export const DEFAULT_DEV_API_URL = "http://localhost:8000";

export function isTauriEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as any).__TAURI_INTERNALS__ ||
    (window as any).__TAURI__ ||
    window.location.protocol === "tauri:" ||
    window.location.protocol === "asset:" ||
    window.location.hostname === "tauri.localhost"
  );
}

export function getBaseUrl(): string {
  if (typeof window !== "undefined") {
    const override = localStorage.getItem("opentask_api_url");
    if (override && override.trim()) {
      return override.trim();
    }
  }

  const envUrl = (
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    ""
  ).trim();

  if (envUrl) {
    return envUrl;
  }

  if (isTauriEnvironment()) {
    return import.meta.env.DEV ? DEFAULT_DEV_API_URL : DEFAULT_PRODUCTION_API_URL;
  }

  return "";
}

export const BASE_URL = getBaseUrl();

export function resolveApiUrl(endpoint: string): string {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const baseUrl = getBaseUrl();

  if (baseUrl) {
    const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;

    // Prevent duplicate /api when cleanBase ends with /api and cleanEndpoint also starts with /api/
    if (cleanBase.endsWith("/api") && cleanEndpoint.startsWith("/api/")) {
      return `${cleanBase}${cleanEndpoint.slice(4)}`;
    }

    return `${cleanBase}${cleanEndpoint}`;
  }

  // In standard browser environment (both local dev and prod without explicit base URL):
  // Ensure the endpoint starts with /api so Vite proxy (dev) and Vercel rewrites (prod) route it to backend:
  if (cleanEndpoint.startsWith("/api/")) {
    return cleanEndpoint;
  }

  return `/api${cleanEndpoint}`;
}

export function getRealtimeBaseUrl(): string {
  const base = getBaseUrl();
  if (base) {
    return base;
  }

  // Vercel rewrites (/api/*) only proxy stateless HTTP requests and cannot upgrade WebSocket (wss://) connections.
  // In production builds without an explicit VITE_API_BASE_URL, connect WebSockets directly to the backend host.
  if (!import.meta.env.DEV) {
    return DEFAULT_PRODUCTION_API_URL;
  }

  return "";
}

export function resolveRealtimeUrl(endpoint: string): URL {
  const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const baseUrl = getRealtimeBaseUrl();
  const fallbackOrigin =
    typeof window !== "undefined" ? window.location.origin : "http://localhost:8000";

  if (baseUrl) {
    const cleanBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
    const apiEndpoint = cleanEndpoint.startsWith("/api/")
      ? cleanEndpoint
      : `/api${cleanEndpoint}`;
    const fullUrl =
      cleanBase.endsWith("/api") && apiEndpoint.startsWith("/api/")
        ? `${cleanBase}${apiEndpoint.slice(4)}`
        : `${cleanBase}${apiEndpoint}`;

    const wsUrl = new URL(fullUrl, fallbackOrigin);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    return wsUrl;
  }

  const wsUrl = new URL(resolveApiUrl(cleanEndpoint), fallbackOrigin);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  return wsUrl;
}

export function getStoredToken(): string | null {
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get("token");
    if (urlToken) {
      localStorage.setItem("gh_token", urlToken);
      params.delete("token");
      const newQuery = params.toString() ? `?${params.toString()}` : "";
      window.history.replaceState({}, document.title, `${window.location.pathname}${newQuery}`);
      return urlToken;
    }
    return localStorage.getItem("gh_token");
  }
  return null;
}

// Map to cleanly deduplicate concurrent identical GET requests
const pendingGetRequests = new Map<string, Promise<unknown>>();

export function clearPendingGetRequests(): void {
  pendingGetRequests.clear();
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const url = resolveApiUrl(endpoint);

  const method = (options.method || "GET").toUpperCase();
  if (method !== "GET") {
    pendingGetRequests.clear();
  }
  const cacheKey = method === "GET" ? url : null;

  // Deduplicate identical simultaneous GET requests to prevent "multiple getter" loops and StrictMode duplicate calls
  if (cacheKey && pendingGetRequests.has(cacheKey)) {
    return pendingGetRequests.get(cacheKey) as Promise<T>;
  }

  const token = getStoredToken();
  const defaultHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const config = {
    ...options,
    credentials: options.credentials || "include",
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  const fetchPromise = (async () => {
    let attempts = 0;
    const isIdempotent = ["GET", "HEAD", "PUT", "DELETE"].includes(method);
    const maxAttempts = isIdempotent ? 2 : 1;

    try {
      while (attempts < maxAttempts) {
        attempts++;
        try {
          const response = await fetch(url, config);

          if (!response.ok) {
            // If server error on idempotent request (e.g. cold start / pooler reset), retry once before failing
            if (attempts < maxAttempts && isIdempotent && response.status >= 500 && response.status <= 504) {
              await new Promise((res) => setTimeout(res, 350));
              continue;
            }

            let errorData: Record<string, unknown> = {};
            let errorText = "";
            try {
              errorText = await response.text();
              errorData = errorText ? JSONBig({ storeAsString: true }).parse(errorText) : {};
            } catch {
              // Non-JSON error body (e.g. plain text from the Rust API); use it verbatim below
            }

            throw new Error(
              (errorData.detail as string) ||
              (errorText && !errorText.trim().startsWith("{") ? errorText.trim() : "") ||
              `API Error: ${response.status} ${response.statusText}`,
            );
          }

          const text = await response.text();
          return (text ? JSONBig({ storeAsString: true }).parse(text) : {}) as T;
        } catch (error) {
          if (attempts < maxAttempts && isIdempotent) {
            await new Promise((res) => setTimeout(res, 350));
            continue;
          }
          console.error(`Fetch error at ${url}:`, error);
          throw error;
        }
      }
      throw new Error(`Request failed after ${attempts} attempts`);
    } finally {
      // Remove from pending map shortly after resolving to allow for minor timing discrepancies
      // e.g React StrictMode or slightly delayed sibling component mounts.
      if (cacheKey) {
        setTimeout(() => pendingGetRequests.delete(cacheKey), 100);
      }
    }
  })();

  if (cacheKey) {
    pendingGetRequests.set(cacheKey, fetchPromise);
  }

  return fetchPromise;
}
