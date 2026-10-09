"""Rewrite the offset maps in src/v16/constants.ts from tests/fixtures/prog-layout.json."""
import json, re, sys
L = json.load(open(sys.argv[1])); path = sys.argv[2]
ts = open(path).read()
MAPS = {"WC": "WrapperConfigV16", "AOP": "AssetOracleProfileV16", "MG": "MarketGroupV16HeaderAccount",
        "AS": "AssetStateV16Account", "PA": "PortfolioAccountV16Account", "PL": "PortfolioLegV16Account",
        "PROV": "ProvenanceHeaderV16Account", "ACS": "AssetControlSequencesV16", "PMC": "PortfolioMatcherConfigV16"}
EXTRA = {"MG": ["  asset_slots: MARKET_GROUP_HEADER_LEN, // per-asset slots start right after the header"]}
for name, rust in MAPS.items():
    s = L[rust]
    rows = [f"  {f}: {o},{' ' * max(1, 44 - len(f) - len(str(o)))}// {n} B" for f, o, n in s["fields"]]
    body = "\n".join(rows + EXTRA.get(name, []))
    block = (f"// {rust}: size {s['size']}, align {s['align']} (generated from tests/fixtures/prog-layout.json)\n"
             f"export const {name} = {{\n{body}\n}} as const;")
    pat = re.compile(r"(?:// [A-Za-z0-9]+: size \d+, align \d+ \(generated[^\n]*\n)?export const %s = \{.*?\} as const;" % name, re.S)
    ts, n = pat.subn(lambda m: block, ts)
    assert n == 1, name
open(path, "w").write(ts)
