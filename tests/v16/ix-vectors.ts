/**
 * Offline check: every generated encoder in src/v16/encode.gen.ts must produce exactly the bytes
 * the program's own ix::Instruction::encode() produces (tests/fixtures/ix-vectors.jsonl, emitted by
 * percolator-prog `cargo run --example ix_vectors`, which also asserts decode(encode(x)) == x).
 * Run: pnpm tsx tests/v16/ix-vectors.ts
 */
import * as fs from "fs";
import * as G from "../../src/v16/encode.gen.js";

const conv = (v: any): any => {
  if (Array.isArray(v)) return v.map(conv);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, conv(x)]));
  if (typeof v !== "string") return v;
  if (v.startsWith("b32x3:")) { const k = Number(v.slice(6)); return [0, 1, 2].map((d) => new Uint8Array(32).fill((k + d) % 256)); }
  if (v.startsWith("b32:")) return new Uint8Array(32).fill(Number(v.slice(4)));
  const b = BigInt(v);
  return b >= -(2n ** 31n) && b < 2n ** 32n ? Number(b) : b;
};

let fail = 0, n = 0;
for (const line of fs.readFileSync(new URL("../fixtures/ix-vectors.jsonl", import.meta.url), "utf8").trim().split("\n")) {
  const { variant, args, hex } = JSON.parse(line);
  const fn = (G as any)["enc" + variant];
  n++;
  if (!fn) { fail++; console.log(`FAIL ${variant}: no encoder`); continue; }
  const got = (Object.keys(args).length ? fn(conv(args)) : fn()).toString("hex");
  if (got !== hex) { fail++; console.log(`FAIL ${variant}\n  sdk:     ${got}\n  program: ${hex}`); }
}
console.log(fail ? `${fail}/${n} encoders differ from program` : `ix OK: all ${n} encoders byte-identical to program`);
process.exit(fail ? 1 : 0);
