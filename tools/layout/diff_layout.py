import json,sys
a=json.load(open(sys.argv[1])); b=json.load(open(sys.argv[2]))
for s in sorted(set(a)|set(b)):
    if s=="_constants":
        if a.get(s)!=b.get(s): print("CONST", a.get(s), "->", b.get(s))
        continue
    if s not in a: print(f"+ NEW STRUCT {s} size={b[s]['size']}"); continue
    if s not in b: print(f"- GONE STRUCT {s}"); continue
    fa={f[0]:(f[1],f[2]) for f in a[s]["fields"]}; fb={f[0]:(f[1],f[2]) for f in b[s]["fields"]}
    ch=[]
    for f in [x[0] for x in b[s]["fields"]]:
        if f not in fa: ch.append(f"   + {f} @{fb[f][0]} ({fb[f][1]}B)")
        elif fa[f]!=fb[f]: ch.append(f"   ~ {f} {fa[f][0]}/{fa[f][1]}B -> {fb[f][0]}/{fb[f][1]}B")
    for f in fa:
        if f not in fb: ch.append(f"   - {f} (was @{fa[f][0]} {fa[f][1]}B)")
    if ch or a[s]["size"]!=b[s]["size"]:
        print(f"{s}: size {a[s]['size']} -> {b[s]['size']}"); print("\n".join(ch))
