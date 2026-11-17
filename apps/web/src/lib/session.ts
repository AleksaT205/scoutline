import { useEffect, useState } from "react";

/** Prijavljeni korisnik (Faza 5). Token i korisnik se čuvaju u browseru. */
export interface SessionUser {
  id: string | null;
  email: string;
  name: string;
  role: "owner" | "member" | "viewer";
  access?: "all" | "sales" | "delivery"; // koji deo aplikacije vidi (vlasnik uvek sve)
}

/** Koji prostor korisnik sme: null = oba. */
export const onlySpace = (u: SessionUser | null): "sales" | "delivery" | null => (u && u.role !== "owner" && (u.access === "sales" || u.access === "delivery") ? u.access : null);

const TOKEN_KEY = "scoutline-session";
const USER_KEY = "scoutline-user";
const listeners = new Set<() => void>();

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

export function getSessionToken(): string {
  return read(TOKEN_KEY) ?? "";
}

export function getSessionUser(): SessionUser | null {
  const raw = read(USER_KEY);
  try {
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: SessionUser) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* privatni režim */
  }
  listeners.forEach((l) => l());
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* privatni režim */
  }
  listeners.forEach((l) => l());
}

/** React hook: trenutni korisnik; osvežava se kad se neko prijavi/odjavi. */
export function useSessionUser(): SessionUser | null {
  const [user, setUser] = useState(getSessionUser);
  useEffect(() => {
    const on = () => setUser(getSessionUser());
    listeners.add(on);
    window.addEventListener("storage", on);
    return () => {
      listeners.delete(on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return user;
}

export const canEdit = (u: SessionUser | null) => !u || u.role !== "viewer";
