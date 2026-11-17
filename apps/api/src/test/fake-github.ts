import { createServer, type IncomingMessage, type Server } from "node:http";

/**
 * Lažni GitHub za testove (samo ono što koristi Claude tok): repo, secret, workflow dispatch, sesije, log,
 * grane (compare / rename) i pull request-ovi. Ništa ne ide na pravi GitHub.
 */
type Run = { id: number; display_title: string; status: string; conclusion: string | null; run_started_at: string; created_at: string; updated_at: string; html_url: string };
type Pull = { number: number; title: string; html_url: string; state: "open" | "closed"; merged_at: string | null; body: string; head: { ref: string }; base: { ref: string } };
export interface FakeState {
  workflows: Set<string>;
  secret: string | null;
  dispatches: Array<{ ref: string; inputs: Record<string, string> }>;
  runs: Run[];
  logs: Map<number, string>;
  branches: Map<string, string[]>; // grana → commit poruke (iznad main)
  renames: Array<[string, string]>;
  pulls: Pull[];
}

export async function startFakeGitHub() {
  const S: FakeState = { workflows: new Set([".github/workflows/scoutline-agent.yml"]), secret: null, dispatches: [], runs: [], logs: new Map(), branches: new Map(), renames: [], pulls: [] };
  const now = () => new Date().toISOString();
  const body = (req: IncomingMessage) => new Promise<Record<string, unknown>>((ok) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => ok(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}));
  });
  const R = "/repos/acme/app";
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const p = decodeURIComponent(url.pathname);
    const send = (code: number, data?: unknown) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(data === undefined ? "" : JSON.stringify(data));
    };
    const b = req.method === "GET" ? {} : await body(req);
    if (req.method === "GET") {
      if (p === R) return send(200, { full_name: "acme/app", default_branch: "main", permissions: { push: true } });
      if (p === "/user") return send(200, { login: "dev", id: 7, name: "Dev Person" });
      if (p.startsWith(`${R}/contents/`)) return S.workflows.has(p.slice(`${R}/contents/`.length)) ? send(200, { sha: "s1" }) : send(404, { message: "Not Found" });
      if (p === `${R}/actions/secrets/public-key`) return send(200, { key: Buffer.from(new Uint8Array(32).fill(3)).toString("base64"), key_id: "k1" });
      if (p === `${R}/actions/workflows/scoutline-agent.yml/runs`) return send(200, { workflow_runs: S.runs });
      if (/\/actions\/runs\/\d+\/jobs$/.test(p)) return send(200, { jobs: [{ id: Number(p.split("/")[6]) }] });
      if (/\/actions\/jobs\/\d+\/logs$/.test(p)) {
        const log = S.logs.get(Number(p.split("/")[6]));
        res.writeHead(log ? 200 : 404, { "Content-Type": "text/plain" });
        return res.end(log ?? "");
      }
      if (p.startsWith(`${R}/compare/`)) {
        const head = p.slice(`${R}/compare/`.length).split("...")[1]!;
        const c = S.branches.get(head);
        return c ? send(200, { ahead_by: c.length, commits: c.map((m) => ({ commit: { message: m } })) }) : send(404, { message: "Not Found" });
      }
      if (p.startsWith(`${R}/branches/`)) {
        const name = p.slice(`${R}/branches/`.length);
        return S.branches.has(name) ? send(200, { name, protected: false }) : send(404, { message: "Branch not found" });
      }
      if (p === `${R}/pulls`) return send(200, S.pulls);
      if (p.startsWith(`${R}/pulls/`)) {
        const pr = S.pulls.find((x) => x.number === Number(p.split("/")[5]));
        return pr ? send(200, pr) : send(404, { message: "Not Found" });
      }
    }
    if (req.method === "PUT" && p.startsWith(`${R}/actions/secrets/`)) {
      S.secret = String(b.encrypted_value ?? "");
      return send(201, {});
    }
    if (req.method === "PUT" && p.startsWith(`${R}/contents/`)) {
      S.workflows.add(p.slice(`${R}/contents/`.length));
      return send(201, {});
    }
    if (req.method === "POST") {
      if (p === `${R}/actions/workflows/scoutline-agent.yml/dispatches`) {
        const inputs = b.inputs as Record<string, string>;
        S.dispatches.push({ ref: String(b.ref), inputs });
        const id = 9000 + S.runs.length;
        S.runs.unshift({ id, display_title: `agent ${inputs.id}`, status: "queued", conclusion: null, run_started_at: now(), created_at: now(), updated_at: now(), html_url: `https://github.com/acme/app/actions/runs/${id}` });
        return send(204);
      }
      if (/\/branches\/.+\/rename$/.test(p)) {
        const old = p.slice(`${R}/branches/`.length, -"/rename".length);
        if (!S.branches.has(old)) return send(404, { message: "Branch not found" });
        const name = String(b.new_name);
        S.branches.set(name, S.branches.get(old)!);
        S.branches.delete(old);
        S.renames.push([old, name]);
        // Kao pravi GitHub: preimenovanje grane otvorenog PR-a zatvara taj PR
        for (const pr of S.pulls) if (pr.head.ref === old && pr.state === "open") pr.state = "closed";
        return send(201, { name });
      }
      if (p === `${R}/pulls`) {
        const n = 100 + S.pulls.length;
        const pr: Pull = { number: n, title: String(b.title), html_url: `https://github.com/acme/app/pull/${n}`, state: "open", merged_at: null, body: String(b.body ?? ""), head: { ref: String(b.head) }, base: { ref: String(b.base) } };
        S.pulls.unshift(pr);
        return send(201, pr);
      }
    }
    send(404, { message: "Not Found" });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as { port: number }).port;

  /** Simuliraj kraj rada poslednjeg pokretanja: commit-i na grani + log sa SCOUTLINE_RESULT. */
  const finishLast = (o: { commits?: string[]; text?: string; ok?: boolean } = {}) => {
    const d = S.dispatches.at(-1)!;
    const run = S.runs.find((r) => r.display_title === `agent ${d.inputs.id}`)!;
    run.status = "completed";
    run.conclusion = o.ok === false ? "failure" : "success";
    run.updated_at = now();
    const commits = o.commits ?? [];
    if (commits.length) S.branches.set(d.inputs.branch!, [...(S.branches.get(d.inputs.branch!) ?? []), ...commits]);
    const res = { ok: o.ok !== false, text: o.text ?? "Done.", cost: 0.1, turns: 3, ms: 60_000, in: 1000, out: 100, steps: ["Edit a.css"], commits };
    S.logs.set(run.id, `2026-01-01T00:00:00Z SCOUTLINE_RESULT ${Buffer.from(JSON.stringify(res)).toString("base64")}\n`);
    return d;
  };
  return { url: `http://127.0.0.1:${port}`, state: S, finishLast, close: () => new Promise<void>((ok) => server.close(() => ok())) };
}
