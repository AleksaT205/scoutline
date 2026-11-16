/** Vrste usluga koje nudimo — AI ih dodeljuje svakom leadu. */
export const SERVICE_CATEGORIES = [
  "fullstack_app",
  "web_frontend",
  "backend_api",
  "mobile",
  "ai_integration",
  "automation",
  "devops_deploy",
  "bugfix_maintenance",
  "other_dev",
  "not_relevant",
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const INDUSTRIES = [
  "ecommerce",
  "saas",
  "fintech",
  "healthcare",
  "real_estate",
  "marketing",
  "education",
  "logistics",
  "public_sector",
  "other",
] as const;
export type Industry = (typeof INDUSTRIES)[number];

/** Tip leada (Roadmap 2.0): projekti za firmu su važniji od oglasa za posao. */
export const LEAD_TYPES = ["tender", "project", "intent", "hiring_signal"] as const;
export type LeadType = (typeof LEAD_TYPES)[number];

export const LEAD_STATUSES = ["new", "contacted", "replied", "meeting", "won", "lost", "hidden"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
