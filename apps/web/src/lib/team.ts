import { API_URL } from "./api";

const TOKEN_KEY = "scoutline-team-token";

export function getTeamToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setTeamToken(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* privatni režim — samo ne pamtimo */
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Poziv API-ja sa timskom lozinkom; baca ApiError sa porukom servera. */
export async function teamFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getTeamToken()}`, ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Can't reach the server. Check that the backend is running.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (HTTP ${res.status})`, res.status);
  return data;
}

export const usd = (v: number) =>
  v === 0 ? "$0.00" : v < 0.01 ? `$${v.toFixed(4)}` : v < 100 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString("en-US")}`;
