import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { teamFetch } from "../lib/team";
import { useSessionUser } from "../lib/session";
import { input } from "../lib/ui";
import { loadOrg, orgChanged, type Organization } from "../lib/org";

/** Settings → Organization: ime, logo i boja firme (meni, portal klijenta, izveštaji). Menja vlasnik. */
export function OrganizationSettings() {
  const user = useSessionUser();
  const owner = user?.role === "owner" || !user;
  const [f, setF] = useState<Organization>({ name: "", logoUrl: "", accent: "#5b4bff", website: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    void loadOrg(true).then((o) => o && setF(o));
  }, []);
  const set = (k: keyof Organization) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-4">
        <div className="text-[14px] font-medium">Organization</div>
        <div className="text-[12.5px] text-muted">Your company name and logo — shown in the menu, on client portals and in client status updates.</div>
      </div>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await teamFetch("/organization", { method: "PUT", body: JSON.stringify(f) });
            await orgChanged();
            setMsg({ ok: true, text: "Saved." });
          } catch (err) {
            setMsg({ ok: false, text: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          <span className="mb-1 block text-[12px] text-muted">Company name</span>
          <input className={input} disabled={!owner} value={f.name} onChange={set("name")} placeholder="Acme Studio" />
        </label>
        <label>
          <span className="mb-1 block text-[12px] text-muted">Logo URL (https, square works best)</span>
          <input className={input} disabled={!owner} value={f.logoUrl} onChange={set("logoUrl")} placeholder="https://…/logo.png" />
        </label>
        <label>
          <span className="mb-1 block text-[12px] text-muted">Brand color (client portal)</span>
          <span className="flex gap-2">
            <input type="color" disabled={!owner} value={f.accent} onChange={set("accent")} className="h-[34px] w-12 cursor-pointer rounded-lg border border-line bg-bg" aria-label="Brand color" />
            <input className={`${input} num`} disabled={!owner} value={f.accent} onChange={set("accent")} />
          </span>
        </label>
        <label>
          <span className="mb-1 block text-[12px] text-muted">Website</span>
          <input className={input} disabled={!owner} value={f.website} onChange={set("website")} placeholder="https://acme.studio" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[12px] text-muted">Contact email (shown to clients)</span>
          <input className={input} disabled={!owner} value={f.email} onChange={set("email")} placeholder="hello@acme.studio" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[12px] text-muted">Invoice details (address, company ID, VAT number, bank account — printed on invoices)</span>
          <textarea
            className="min-h-[84px] w-full rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none placeholder:text-faint focus:border-accent/60 disabled:opacity-60"
            disabled={!owner}
            value={f.invoiceDetails ?? ""}
            onChange={(e) => setF({ ...f, invoiceDetails: e.target.value })}
            placeholder={"Acme Studio d.o.o.\nBulevar 1, 11000 Beograd\nPIB 123456789 · MB 12345678\nRačun 160-0000000000000-00"}
          />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          {f.logoUrl && <img src={f.logoUrl} alt="" className="size-9 rounded-lg border border-line object-cover" />}
          <span className="text-[13px] font-medium" style={{ color: f.accent }}>
            {f.name || "Your company"}
          </span>
          {owner && (
            <button disabled={busy} className="ml-auto inline-flex h-[34px] items-center gap-1.5 rounded-lg bg-fg px-3.5 text-[13px] font-medium text-bg disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </button>
          )}
        </div>
        {msg && <div className={`rounded-lg border px-3 py-2 text-[12.5px] sm:col-span-2 ${msg.ok ? "border-success/40 bg-success-soft text-success" : "border-danger/40 bg-danger/10 text-danger"}`}>{msg.text}</div>}
        {!owner && <p className="text-[12px] text-faint sm:col-span-2">Only the owner can change the organization profile.</p>}
      </form>
    </section>
  );
}
