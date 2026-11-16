/** Delivery (Faza 10): klijenti, projekti i taskovi — kao Linear. */
export const PROJECT_STATUSES = ["planned", "active", "paused", "done", "canceled"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ISSUE_STATUSES = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** Prioritet kao u Linear-u: 0 = bez, 1 = hitno, 2 = visok, 3 = srednji, 4 = nizak. */
export const ISSUE_PRIORITIES = [0, 1, 2, 3, 4] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];

/** Ključ projekta za oznake taskova (npr. „ACME“ → ACME-12): slova iz naziva, 2–5 znakova. */
export function projectKey(name: string): string {
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "PRJ";
  const key = words.length === 1 ? words[0]!.slice(0, 4) : words.map((w) => w[0]).join("").slice(0, 5);
  return key.length >= 2 ? key : (words[0]! + "X").slice(0, 3);
}
