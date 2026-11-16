import type { LeadStatus, LeadType, ServiceCategory, Tier } from "@radar/shared";

export interface UiLead {
  id: string;
  title: string;
  company: string;
  industry: string;
  country: string | null; // ISO alpha-2
  city: string;
  tier: Tier | null;
  category: ServiceCategory;
  leadType?: LeadType; // tender | project | intent | hiring_signal
  deadline?: string | null; // rok za prijavu (tenderi), ISO
  budgetLabel: string;
  budgetEur: number;
  source: string;
  postedMinutesAgo: number | null;
  url?: string;
  createdAt?: string; // kad je lead dodat (samo pravi podaci)
  score: number;
  remote: string;
  remoteOk?: boolean | null;
  scoredBy?: string | null;
  status?: LeadStatus; // "rules" | "ai:<model>"
  companySize?: string;
  urgency: string;
  why: string[];
  email: { subject: string; body: string };
}

/** Primeri dok worker ne počne da skuplja prave oglase (Faza 1). Firme su izmišljene. */
export const DEMO_LEADS: UiLead[] = [
  {
    id: "1",
    title: "Full-stack developer for patient portal MVP",
    company: "Kite Health Inc.",
    industry: "Healthcare",
    country: "US",
    city: "Austin, TX",
    tier: "T1",
    category: "fullstack_app",
    budgetLabel: "€18–25k",
    budgetEur: 21500,
    source: "HN Hiring",
    postedMinutesAgo: 12,
    score: 92,
    remote: "Worldwide",
    companySize: "11–50, no in-house dev",
    urgency: "Launch in Q1",
    why: [
      "Needs a complete web app (React + Node + Postgres) — matches the full-stack offer.",
      "Asks for an AI-assisted intake form — upsell for AI integration.",
      "Contract role, worldwide — open to agencies outside the US.",
    ],
    email: {
      subject: "Patient portal MVP — shipped in 8 weeks",
      body: "Hi, saw you're building a patient portal with an AI-assisted intake. We've delivered similar React/Node apps and could share a 2-page plan for your MVP. Would a 20-minute call next week be useful?",
    },
  },
  {
    id: "2",
    title: "Integrate LLM assistant into existing SaaS dashboard",
    company: "Fjord Analytics AB",
    industry: "SaaS",
    country: "SE",
    city: "Stockholm",
    tier: "T1",
    category: "ai_integration",
    budgetLabel: "€90/h",
    budgetEur: 14000,
    source: "RemoteOK",
    postedMinutesAgo: 38,
    score: 88,
    remote: "EU time zone",
    companySize: "51–200",
    urgency: "Start this month",
    why: [
      "Wants an in-app AI assistant on top of their own data — core AI integration work.",
      "Existing product and budget; scope is clear and well-paid.",
      "CET overlap requested — fits our time zone.",
    ],
    email: {
      subject: "AI assistant for your dashboard — 3-week pilot",
      body: "Hi, we build in-app AI assistants that answer questions from a product's own data, with guardrails and cost tracking. Happy to outline a 3-week pilot for your dashboard — open to a quick call?",
    },
  },
  {
    id: "3",
    title: "Migrate Laravel shop to Next.js + headless commerce",
    company: "Lumen Retail GmbH",
    industry: "E-commerce",
    country: "DE",
    city: "Berlin",
    tier: "T1",
    category: "web_frontend",
    budgetLabel: "€12k",
    budgetEur: 12000,
    source: "Arbeitnow",
    postedMinutesAgo: 65,
    score: 85,
    remote: "Remote (EU)",
    companySize: "11–50",
    urgency: "Q1",
    why: [
      "Fixed-scope migration with a clear budget.",
      "Modern stack (Next.js, headless) we deliver regularly.",
      "Ongoing maintenance likely after launch.",
    ],
    email: {
      subject: "Next.js migration for Lumen Retail",
      body: "Hi, we've migrated several Laravel shops to Next.js with headless commerce, keeping SEO and orders intact. Could share a migration checklist and timeline — interested?",
    },
  },
  {
    id: "4",
    title: "DevOps: move from Heroku to AWS with CI/CD",
    company: "Harbor & Co",
    industry: "Fintech",
    country: "GB",
    city: "London",
    tier: "T1",
    category: "devops_deploy",
    budgetLabel: "€8–10k",
    budgetEur: 9000,
    source: "WWR",
    postedMinutesAgo: 120,
    score: 81,
    remote: "Worldwide",
    companySize: "11–50",
    urgency: "ASAP",
    why: ["Clear infrastructure project with a budget.", "Fintech — values reliability and documentation.", "Remote contractors welcome."],
    email: {
      subject: "Heroku → AWS with zero downtime",
      body: "Hi, we help teams move from Heroku to AWS with CI/CD, monitoring and a rollback plan. Happy to send a short migration outline — would that help?",
    },
  },
  {
    id: "5",
    title: "Customer support automation with n8n + OpenAI",
    company: "Mesa Freight LLC",
    industry: "Logistics",
    country: "CA",
    city: "Toronto",
    tier: "T1",
    category: "automation",
    budgetLabel: "€6k",
    budgetEur: 6000,
    source: "Remotive",
    postedMinutesAgo: 180,
    score: 78,
    remote: "Remote",
    companySize: "51–200",
    urgency: "This quarter",
    why: ["Repetitive support tickets — strong automation case.", "Names the exact tools we use (n8n, OpenAI).", "Follow-up automation work likely."],
    email: {
      subject: "Automating support tickets with n8n",
      body: "Hi, we build n8n + AI workflows that triage and draft replies to support tickets, with a human in the loop. Could show a similar setup in 15 minutes — interested?",
    },
  },
  {
    id: "6",
    title: "Fix performance issues in React Native app",
    company: "Solace Studio",
    industry: "Wellness",
    country: "ES",
    city: "Barcelona",
    tier: "T2",
    category: "bugfix_maintenance",
    budgetLabel: "€55/h",
    budgetEur: 4000,
    source: "RemoteOK",
    postedMinutesAgo: 240,
    score: 74,
    remote: "Remote (EU)",
    companySize: "2–10",
    urgency: "Urgent",
    why: ["Concrete, urgent problem — quick win.", "Could lead to ongoing maintenance retainer.", "Small team without senior mobile dev."],
    email: {
      subject: "Speeding up your React Native app",
      body: "Hi, we profile and fix React Native performance issues (startup time, lists, memory). Happy to do a short audit first — would that be useful?",
    },
  },
  {
    id: "7",
    title: "Public tender: web portal for municipal services",
    company: "EU TED",
    industry: "Public sector",
    country: "AT",
    city: "Vienna",
    tier: "T1",
    category: "fullstack_app",
    budgetLabel: "€40k",
    budgetEur: 40000,
    source: "EU TED",
    postedMinutesAgo: 360,
    score: 71,
    remote: "Hybrid",
    companySize: "Public body",
    urgency: "Deadline in 21 days",
    why: ["Large budget and a fixed deadline.", "Full-stack portal — matches our core offer.", "Requires a formal bid; check eligibility."],
    email: {
      subject: "Bid preparation — municipal web portal",
      body: "Internal note: review tender documents, eligibility and required references before preparing a bid.",
    },
  },
  {
    id: "8",
    title: "Web aplikacija za zakazivanje termina",
    company: "Digitalni Servis d.o.o.",
    industry: "Services",
    country: "RS",
    city: "Beograd",
    tier: "DOMESTIC",
    category: "fullstack_app",
    budgetLabel: "€3.5k",
    budgetEur: 3500,
    source: "Infostud",
    postedMinutesAgo: 420,
    score: 69,
    remote: "Remote",
    companySize: "11–50",
    urgency: "Do kraja meseca",
    why: ["Jasan obim posla i budžet.", "Domaći klijent — brza komunikacija.", "Mogućnost održavanja nakon lansiranja."],
    email: {
      subject: "Aplikacija za zakazivanje — predlog",
      body: "Zdravo, pravimo web aplikacije za zakazivanje sa podsetnicima i online plaćanjem. Možemo da pošaljemo kratak predlog i rok — da li vam odgovara kratak poziv?",
    },
  },
];
