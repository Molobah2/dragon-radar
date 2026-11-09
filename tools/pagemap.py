"""Page map for the redesign: which route renders which template, what each
template pulls in (includes, CSS, JS), and which ids the scripts look up.
Graphify maps the Python and JS; this covers the HTML templates and CSS it skips.
Run: python tools/pagemap.py  (writes graphify-out/PAGES.md)"""
import re, pathlib, collections
ROOT = pathlib.Path(__file__).resolve().parent.parent
R = ROOT / "radar"
out = ["# pdtools page map", "", "Made by tools/pagemap.py. Rebuild after template changes.", ""]

# routes -> templates (web.py style: @app.get/@app.route then render_template in the body)
routes = collections.defaultdict(set)
for py in sorted(R.glob("*.py")):
    route, pending = None, []
    for line in py.read_text(encoding="utf-8", errors="ignore").splitlines():
        m = re.search(r'@(?:app|bp|\w+)\.(?:route|get|post)\(\s*["\']([^"\']+)', line)
        if m:
            pending.append(m.group(1)); continue
        if re.match(r'\s*def \w+', line):
            route = ", ".join(pending) if pending else None
            pending = []
            continue
        if route:
            for t in re.findall(r'render_template\(\s*["\']([\w./-]+\.html)', line):
                routes[t].add(f"{route} ({py.name})")
            for f in re.findall(r'send_from_directory\(\s*(\w+)', line):
                routes[f"[{f}]"].add(f"{route} ({py.name})")

tpl_dir = R / "templates"
static_ids = collections.defaultdict(set)
js_files = list((R / "static").rglob("*.js"))
for js in js_files:
    if js.name.endswith(".min.js") or "vendor" in js.parts or js.stat().st_size > 1_000_000:
        continue
    src = js.read_text(encoding="utf-8", errors="ignore")
    for i in re.findall(r'getElementById\(\s*["\']([\w-]+)', src) + re.findall(r'querySelector(?:All)?\(\s*["\']#([\w-]+)', src):
        static_ids[i].add(js.relative_to(R).as_posix())

out += ["## Templates", "", "| Template | Routes | Includes | CSS | JS |", "| --- | --- | --- | --- | --- |"]
for t in sorted(tpl_dir.glob("*.html")):
    s = t.read_text(encoding="utf-8", errors="ignore")
    inc = sorted(set(re.findall(r'{%\s*(?:include|extends|import|from)\s*["\']([\w./-]+)', s)))
    css = sorted(set(re.findall(r'([\w./-]+\.css)', s)))
    js = sorted(set(re.findall(r'([\w./-]+\.js)\b', s)))
    out.append(f"| {t.name} | {', '.join(sorted(routes.get(t.name, []))) or '(included / none)'} | {', '.join(inc)} | {', '.join(css)} | {', '.join(js)} |")

out += ["", "## Static apps served whole", ""]
for k, v in sorted(routes.items()):
    if k.startswith("["):
        out.append(f"- {k}: {', '.join(sorted(v))}")

out += ["", "## Ids that scripts look up (do not rename in a redesign)", "", "| Id | Used by | In templates |", "| --- | --- | --- |"]
tpl_text = {t.name: t.read_text(encoding="utf-8", errors="ignore") for t in tpl_dir.glob("*.html")}
for i in sorted(static_ids):
    where = [n for n, s in tpl_text.items() if re.search(rf'id=["\']{re.escape(i)}["\']', s)]
    out.append(f"| {i} | {', '.join(sorted(static_ids[i]))} | {', '.join(sorted(where)) or '(made by script or in static html)'} |")

css_files = sorted(p.relative_to(R).as_posix() for p in (R / "static").rglob("*.css"))
out += ["", "## Stylesheets", ""] + [f"- {c}" for c in css_files]
(ROOT / "graphify-out").mkdir(exist_ok=True)
(ROOT / "graphify-out" / "PAGES.md").write_text("\n".join(out) + "\n", encoding="utf-8")
print("\n".join(out[:12])); print(f"... {len(out)} lines, {len(static_ids)} script ids")
