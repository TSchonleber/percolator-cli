/**
 * Offline check: every byte offset / length in src/v16/constants.ts must match
 * the compiler-reported layout of the deployed program (tests/fixtures/prog-layout.json,
 * produced by `layout/gen_dump.py` + `cargo run --example dump_layout_json` in percolator-prog).
 * Run: pnpm tsx tests/v16/layout-check.ts
 */
import * as fs from "fs";
import * as C from "../../src/v16/constants.js";

type Struct = { size: number; align: number; fields: [string, number, number][] };
const L: Record<string, Struct> & { _constants: Record<string, number> } =
  JSON.parse(fs.readFileSync(new URL("../fixtures/prog-layout.json", import.meta.url), "utf8"));

let failures = 0;
const fail = (m: string) => { failures++; console.log("FAIL " + m); };
const eq = (what: string, got: number, want: number) => { if (got !== want) fail(`${what}: sdk=${got} program=${want}`); };

// TS map -> Rust struct. Keys absent from the Rust struct are failures unless whitelisted here
// (aliases that intentionally point at a different place).
const MAPS: [string, Record<string, number>, string, Set<string>][] = [
  ["WC", C.WC as any, "WrapperConfigV16", new Set()],
  ["AOP", C.AOP as any, "AssetOracleProfileV16", new Set()],
  ["MG", C.MG as any, "MarketGroupV16HeaderAccount", new Set(["asset_slots"])],
  ["AS", C.AS as any, "AssetStateV16Account", new Set()],
  ["PA", C.PA as any, "PortfolioAccountV16Account", new Set()],
  ["PL", C.PL as any, "PortfolioLegV16Account", new Set()],
  ["PROV", C.PROV as any, "ProvenanceHeaderV16Account", new Set()],
  ["ACS", C.ACS as any, "AssetControlSequencesV16", new Set()],
  ["PMC", C.PMC as any, "PortfolioMatcherConfigV16", new Set()],
];
for (const [tsName, map, rust, skip] of MAPS) {
  const s = L[rust];
  if (!s) { fail(`struct ${rust} missing from fixture`); continue; }
  const byName = new Map(s.fields.map(([n, o]) => [n, o]));
  for (const [k, off] of Object.entries(map)) {
    if (skip.has(k)) continue;
    if (!byName.has(k)) { fail(`${tsName}.${k}: no field '${k}' in ${rust}`); continue; }
    eq(`${tsName}.${k}`, off, byName.get(k)!);
  }
}

// Every program constant in the fixture must exist in the SDK with the same value
// (MARKET_ASSET_SLOT_LEN is called ASSET_SLOT_LEN, MARKET_GROUP_LEN is MARKET_GROUP_HEADER_LEN).
const RENAME: Record<string, string> = { MARKET_ASSET_SLOT_LEN: "ASSET_SLOT_LEN", MARKET_GROUP_LEN: "MARKET_GROUP_HEADER_LEN" };
for (const [k, v] of Object.entries(L._constants)) {
  const name = RENAME[k] ?? k;
  const got = (C as any)[name];
  if (typeof got !== "number") fail(`constant ${name} missing from SDK`); else eq(name, got, v);
}
eq("ENGINE_ASSET_SLOT_LEN", C.ENGINE_ASSET_SLOT_LEN, L.EngineAssetSlotV16Account.size);
eq("MARKET_GROUP_HEADER_LEN", C.MARKET_GROUP_HEADER_LEN, L.MarketGroupV16HeaderAccount.size);
eq("ASSET_LEN", C.ASSET_LEN, L.AssetStateV16Account.size);
eq("PORTFOLIO_STATE_LEN", C.PORTFOLIO_STATE_LEN, L.PortfolioAccountV16Account.size);
eq("PORTFOLIO_MATCHER_CONFIG_LEN", C.PORTFOLIO_MATCHER_CONFIG_LEN, L.PortfolioMatcherConfigV16.size);
eq("LEG_LEN", C.LEG_LEN, L.PortfolioLegV16Account.size);
eq("PROVENANCE_LEN", C.PROVENANCE_LEN, L.ProvenanceHeaderV16Account.size);

console.log(failures ? `\n${failures} layout mismatches` : "layout OK: SDK constants match program layout");
process.exit(failures ? 1 : 0);
