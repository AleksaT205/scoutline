import type { UiLead } from "../data/demo";

/** Lead za testove — navodi se samo ono što test proverava. */
export const lead = (over: Partial<UiLead> & { id: string }): UiLead => ({
  title: `Lead ${over.id}`,
  company: "Test Co",
  industry: "saas",
  country: "DE",
  city: "Berlin",
  tier: "T1",
  category: "fullstack_app",
  leadType: "project",
  budgetLabel: "—",
  budgetEur: 0,
  source: "Test source",
  postedMinutesAgo: 60,
  score: 60,
  remote: "Remote",
  urgency: "—",
  why: [],
  email: { subject: "", body: "" },
  status: "new",
  ...over,
});
