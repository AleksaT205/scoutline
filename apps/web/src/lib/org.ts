import { useEffect, useState } from "react";
import { API_URL } from "./api";

/** Profil organizacije (Settings → Organization): ime, logo, boja — u meniju, portalu klijenta i izveštajima. */
export interface Organization {
  name: string;
  logoUrl: string;
  accent: string;
  website: string;
  email: string;
  invoiceDetails?: string;
}
let cache: Promise<Organization | null> | null = null;
const listeners = new Set<(o: Organization | null) => void>();
export const loadOrg = (force = false) => {
  if (!cache || force) cache = fetch(`${API_URL}/organization`).then((r) => (r.ok ? r.json() : null)).then((d: { organization?: Organization } | null) => d?.organization ?? null).catch(() => null);
  return cache;
};
export function useOrganization(): Organization | null {
  const [org, setOrg] = useState<Organization | null>(null);
  useEffect(() => {
    void loadOrg().then(setOrg);
    listeners.add(setOrg);
    return () => {
      listeners.delete(setOrg);
    };
  }, []);
  return org;
}
export const orgChanged = async () => {
  const o = await loadOrg(true);
  listeners.forEach((l) => l(o));
};
