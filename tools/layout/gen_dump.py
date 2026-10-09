#!/usr/bin/env python3
"""Generate a Rust example that prints offset/size of every field of the v16
account structs, as JSON. Usage: gen_dump.py <percolator-prog dir> <out.rs>"""
import re, sys, os
prog = sys.argv[1]; out = sys.argv[2]
eng_src = os.path.join(prog, "..", "percolator", "src", "v16.rs")
prog_src = os.path.join(prog, "src", "v16_program.rs")
# Engine dep is resolved by cargo; read the engine source from cargo's checkout if given
eng_src = os.environ.get("ENGINE_SRC", eng_src)
src = {"eng": open(eng_src).read(), "prog": open(prog_src).read()}

def fields(text, name):
    m = re.search(r"pub struct %s\s*\{" % re.escape(name), text)
    if not m: return None
    i = m.end(); depth = 1; j = i
    while depth:
        c = text[j]
        if c == "{": depth += 1
        elif c == "}": depth -= 1
        j += 1
    body = text[i:j-1]
    body = re.sub(r"//[^\n]*", "", body)
    return re.findall(r"^\s*(?:pub(?:\([^)]*\))?\s+)?([A-Za-z_]\w*)\s*:", body, re.M)

ENG = ["V16OptionalRecoveryReasonAccount","ProvenanceHeaderV16Account","V16ConfigAccount",
       "SourceCreditStateV16Account","BackingBucketV16Account","InsuranceCreditReservationV16Account",
       "AssetStateV16Account","EngineAssetSlotV16Account","MarketGroupV16HeaderAccount",
       "PortfolioLegV16Account","HealthCertV16Account","CloseProgressLedgerV16Account",
       "ResolvedPayoutLedgerV16Account","ResolvedPayoutReceiptV16Account",
       "PortfolioSourceDomainV16Account","PortfolioAccountV16Account"]
PROG = ["WrapperConfigV16","AssetOracleProfileV16","AssetControlSequencesV16",
        "BackingDomainLedgerAccountV16","InsuranceLedgerAccountV16","PortfolioMatcherConfigV16"]
lines = ["#![allow(unused_imports, deprecated)]","use core::mem::{offset_of, size_of, size_of_val, align_of};",
         "fn main() {", '    println!("{{");']
first = True
for kind, names in (("eng", ENG), ("prog", PROG)):
    for n in names:
        fs = fields(src[kind], n)
        if fs is None:
            sys.stderr.write("skip missing %s\n" % n); continue
        path = ("percolator::" if kind == "eng" else "percolator_prog::state::") + n
        sep = "" if first else ","
        first = False
        lines.append("    { let z: %s = bytemuck::Zeroable::zeroed();" % path)
        lines.append('      println!("%s\\"%s\\": {{\\"size\\": {}, \\"align\\": {}, \\"fields\\": [", size_of::<%s>(), align_of::<%s>());' % (sep, n, path, path))
        for k, f in enumerate(fs):
            c = "," if k else ""
            lines.append('      println!("%s  [\\"%s\\", {}, {}]", offset_of!(%s, %s), size_of_val(&z.%s));' % (c, f, path, f, f))
        lines.append('      println!("]}}"); }')
lines.append("    { use percolator_prog::constants as c;")
lines.append('      println!(",\\"_constants\\": {{\\"HEADER_LEN\\": {}, \\"WRAPPER_CONFIG_LEN\\": {}, \\"MARKET_GROUP_OFF\\": {}, \\"ASSET_ORACLE_PROFILE_LEN\\": {}, \\"ASSET_ORACLE_WRAPPER_LEN\\": {}, \\"MARKET_ASSET_SLOT_LEN\\": {}, \\"MARKET_GROUP_LEN\\": {}, \\"ASSET_CONTROL_SEQUENCES_OFF\\": {}, \\"PORTFOLIO_ENGINE_ACCOUNT_LEN\\": {}, \\"PORTFOLIO_MATCHER_CONFIG_OFF\\": {}, \\"PORTFOLIO_MATCHER_CONTROL_OFF\\": {}, \\"PORTFOLIO_ID_OFF\\": {}, \\"PORTFOLIO_MATCHER_SEQUENCE_OFF\\": {}, \\"PORTFOLIO_MATCHER_EXPIRY_OFF\\": {}, \\"PORTFOLIO_ACCOUNT_LEN\\": {}, \\"KIND_MARKET\\": {}, \\"KIND_PORTFOLIO\\": {}, \\"KIND_BACKING_DOMAIN_LEDGER\\": {}, \\"KIND_INSURANCE_LEDGER\\": {}, \\"KIND_CLOSED_MARKET\\": {}, \\"WRAPPER_MAX_PORTFOLIO_ASSETS\\": {}}}", c::HEADER_LEN, c::WRAPPER_CONFIG_LEN, c::MARKET_GROUP_OFF, c::ASSET_ORACLE_PROFILE_LEN, c::ASSET_ORACLE_WRAPPER_LEN, c::MARKET_ASSET_SLOT_LEN, c::MARKET_GROUP_LEN, c::ASSET_CONTROL_SEQUENCES_OFF, c::PORTFOLIO_ENGINE_ACCOUNT_LEN, c::PORTFOLIO_MATCHER_CONFIG_OFF, c::PORTFOLIO_MATCHER_CONTROL_OFF, c::PORTFOLIO_ID_OFF, c::PORTFOLIO_MATCHER_SEQUENCE_OFF, c::PORTFOLIO_MATCHER_EXPIRY_OFF, c::PORTFOLIO_ACCOUNT_LEN, c::KIND_MARKET, c::KIND_PORTFOLIO, c::KIND_BACKING_DOMAIN_LEDGER, c::KIND_INSURANCE_LEDGER, c::KIND_CLOSED_MARKET, c::WRAPPER_MAX_PORTFOLIO_ASSETS); }')
lines.append('    println!("}}");')
lines.append("}")
open(out, "w").write("\n".join(lines) + "\n")
