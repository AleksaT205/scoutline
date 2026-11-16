import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { parseEmail } from "./email-parse.js";
import type { Connector, RawItem } from "./types.js";

/**
 * Email-in preko IMAP-a (npr. poseban Gmail sa „App password“). Čita nepročitane mejlove iz IMAP_MAILBOX,
 * pravi oglase i označava mejl kao pročitan. Uputstvo: docs/EMAIL-IN.md.
 */
const cfg = () => ({
  host: process.env.IMAP_HOST ?? "",
  port: Number(process.env.IMAP_PORT ?? 993),
  secure: (process.env.IMAP_SECURE ?? "true") !== "false",
  user: process.env.IMAP_USER ?? "",
  pass: process.env.IMAP_PASSWORD ?? "",
  mailbox: process.env.IMAP_MAILBOX ?? "INBOX",
});
export const emailConfigured = () => {
  const c = cfg();
  return Boolean(c.host && c.user && c.pass);
};

const MAX_PER_RUN = 40;

export const emailIn: Connector = {
  id: "email",
  // U nazivu je adresa — tim u dashboard-u vidi gde da prosleđuje obaveštenja
  name: process.env.IMAP_USER ? `Email-in · ${process.env.IMAP_USER}` : "Email-in",
  kind: "email",
  intervalMinutes: Number(process.env.IMAP_INTERVAL_MINUTES ?? 10),
  defaultType: "project",
  curated: true,
  enabled: emailConfigured,
  async fetch() {
    const c = cfg();
    const client = new ImapFlow({ host: c.host, port: c.port, secure: c.secure, auth: { user: c.user, pass: c.pass }, logger: false, socketTimeout: 60_000 });
    await client.connect();
    const out: RawItem[] = [];
    try {
      const lock = await client.getMailboxLock(c.mailbox);
      try {
        const uids = ((await client.search({ seen: false }, { uid: true })) || []).slice(0, MAX_PER_RUN);
        for (const uid of uids) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!msg || !msg.source) continue;
          try {
            const mail = await simpleParser(msg.source);
            const from = mail.from?.value[0]?.address?.toLowerCase() ?? "";
            const items = await parseEmail({
              from,
              subject: mail.subject ?? "",
              html: typeof mail.html === "string" ? mail.html : null,
              text: mail.text ?? null,
              date: mail.date ?? null,
              messageId: mail.messageId ?? `${c.user}:${uid}`,
            });
            out.push(...items);
            console.log(`[email] ${from || "?"} · „${(mail.subject ?? "").slice(0, 60)}“ → ${items.length} oglasa`);
          } catch (e) {
            console.warn(`[email] mejl ${uid} nije obrađen: ${(e as Error).message}`);
          }
          // Pročitan i kad ne sadrži oglase — da ga ne obrađujemo ponovo
          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    return out;
  },
};
