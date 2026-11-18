import { describe, expect, it } from "vitest";
import { maskSecrets, maskText } from "./router-mask.js";

// Lažne vrednosti samo za test (nisu pravi ključevi)
const FAKE_OPENAI = "sk-proj-" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4";
const FAKE_GH = "ghp_" + "A".repeat(36);
const FAKE_AWS = "AKIA" + "ABCDEFGHIJKLMNOP";

describe("maskiranje tajni", () => {
  it("poznati formati ključeva", () => {
    const r = maskText(`key=${FAKE_OPENAI} gh ${FAKE_GH} aws ${FAKE_AWS}`);
    expect(r.text).not.toContain(FAKE_OPENAI);
    expect(r.text).not.toContain(FAKE_GH);
    expect(r.text).not.toContain(FAKE_AWS);
    expect(r.count).toBe(3);
  });
  it("privatni ključ, lozinka u URL-u i Bearer", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----";
    const r = maskText(`${pem}\npostgres://radar:Sup3rTajna@db:5432/radar\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz123456`);
    expect(r.text).toContain("[REDACTED]");
    expect(r.text).not.toContain("MIIEow");
    expect(r.text).not.toContain("Sup3rTajna");
    expect(r.text).toContain("postgres://radar:[REDACTED]@db:5432/radar");
    expect(r.text).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });
  it(".env redovi: tajne da, kod i reference ne", () => {
    const env = ['DATABASE_PASSWORD="x9Kq2mPz7vLw"', "API_KEY=abcd1234efgh5678", "export GITHUB_TOKEN=t0k3n-value-very-long-1234", "PORT=3000", "API_KEY=process.env.API_KEY", "SECRET_KEY=changeme"].join("\n");
    const r = maskText(env);
    expect(r.text).toContain('DATABASE_PASSWORD="[REDACTED]"');
    expect(r.text).toContain("API_KEY=[REDACTED]");
    expect(r.text).toContain("export GITHUB_TOKEN=[REDACTED]");
    expect(r.text).toContain("PORT=3000");
    expect(r.text).toContain("API_KEY=process.env.API_KEY");
    expect(r.text).toContain("SECRET_KEY=changeme");
    expect(r.count).toBe(3);
  });
  it("običan kod ostaje isti", () => {
    const code = "const token = getToken();\nconst password = req.body.password;\nif (apiKey) call(apiKey)";
    expect(maskText(code)).toEqual({ text: code, count: 0 });
  });
  it("JSON telo: menja stringove, ne dira potpise, id-jeve ni base64", () => {
    const body = {
      model: "claude-sonnet-5-5",
      messages: [
        { role: "user", content: [{ type: "text", text: `my key is ${FAKE_OPENAI}` }] },
        { role: "assistant", content: [{ type: "thinking", thinking: "ok", signature: FAKE_OPENAI }] },
        { role: "user", content: [{ type: "image", source: { type: "base64", data: FAKE_OPENAI } }] },
      ],
    };
    const r = maskSecrets(body);
    expect(r.count).toBe(1);
    const s = JSON.stringify(r.value);
    expect(s).toContain("my key is [REDACTED]");
    expect((r.value.messages[1]!.content[0] as { signature: string }).signature).toBe(FAKE_OPENAI);
    expect(JSON.stringify(body)).toContain(`my key is ${FAKE_OPENAI}`); // original nije menjan
  });
  it("isti ulaz daje isti izlaz", () => {
    expect(maskText(`a ${FAKE_GH}`).text).toBe(maskText(`a ${FAKE_GH}`).text);
  });
});
