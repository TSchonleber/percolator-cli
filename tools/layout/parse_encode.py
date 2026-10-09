"""Parse ix::Instruction::encode() from v16_program.rs into an op list per variant (JSON)."""
import re, sys, json
src = open(sys.argv[1]).read()
start = src.index("pub fn encode(&self) -> Vec<u8> {", src.index("pub mod ix {"))
# end of encode fn: match braces
i = src.index("{", start) + 1; d = 1; j = i
while d:
    d += {"{":1,"}":-1}.get(src[j],0); j += 1
body = src[i:j-1]
arms = re.split(r"\n\s*Self::", body)[1:]
out = {}
for arm in arms:
    name = re.match(r"(\w+)", arm).group(1)
    ops = []; in_for = False
    m0 = re.match(r"\w+\s*=>\s*out\.push\((\d+)\)", arm)
    if m0: out[name] = [["tag", int(m0.group(1))]]; continue
    for line in arm.splitlines():
        line = line.strip()
        m = re.match(r"out\.push\((\d+)\)", line)
        if m: ops.append(["tag", int(m.group(1))]); continue
        m = re.match(r"out\.push\(([\w.]+)\.len\(\) as u8\)", line)
        if m: ops.append(["len_u8", m.group(1)]); continue
        m = re.match(r"out\.push\(([\w.]+)(?: as u8)?\)", line)
        if m: ops.append(["u8", m.group(1)]); continue
        m = re.match(r"push_(\w+)\(&mut out, \*?([\w.\[\]]+)\)", line)
        if m: ops.append([m.group(1), m.group(2)]); continue
        m = re.match(r"out\.extend_from_slice\(&?([\w.\[\]]+)\)", line)
        if m: ops.append(["bytes", m.group(1)]); continue
        m = re.match(r"for (\w+) in ([\w.]+)(?:\.iter\(\))? \{", line)
        if m: ops.append(["for", m.group(1), m.group(2)]); in_for = True; continue
        if line == "}" and in_for:
            ops.append(["endfor"]); in_for = False; continue
        if line.startswith(("push", "out.", "for ")):
            ops.append(["UNPARSED", line])
    out[name] = ops
json.dump(out, open(sys.argv[2], "w"), indent=1)
for k, v in out.items():
    print(k, " ".join(o[0] if o[0] in ("endfor",) else f"{o[0]}:{o[1]}" for o in v))
