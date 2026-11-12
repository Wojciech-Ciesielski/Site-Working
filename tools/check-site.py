#!/usr/bin/env python3
"""Sprawdzenie strony (boxes/site) przed wdrożeniem na Cloudflare Pages. Bez zależności poza Pythonem.

- skróty sha256 w CSP (_headers) zgadzają się ze skryptami inline na każdej stronie,
- każdy temat z boxes/help-links/help.json ma stronę help/<ścieżka>.html i wpis w sitemap.xml,
- linki i zasoby wewnętrzne (/…, #kotwica, logo.svg#s) prowadzą do istniejących plików i id,
- znaczniki są domknięte, klucze data-t mają tłumaczenie w assets/site.js,
- każdy blok data-l="pl" ma odpowiednik data-l="en".

Użycie: python3 tools/check-site.py [katalog strony]
"""
import base64, hashlib, html.parser, json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "boxes/site"
HELP = ROOT / "boxes/help-links/help.json"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
SVG_SELF = {"use", "path", "circle", "rect", "line", "polyline", "polygon", "ellipse", "stop"}

errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


class Page(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, int]] = []
        self.ids: set[str] = set()
        self.refs: list[tuple[str, int]] = []
        self.keys: set[str] = set()
        self.langs = {"pl": 0, "en": 0}
        self.scripts: list[str] = []
        self.problems: list[str] = []
        self._script: list[str] | None = None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        line = self.getpos()[0]
        if a.get("id"):
            if a["id"] in self.ids:
                self.problems.append(f"{line}: powtórzone id „{a['id']}”")
            self.ids.add(a["id"])
        for k in ("href", "src"):
            if a.get(k):
                self.refs.append((a[k], line))
        if a.get("data-t"):
            self.keys.add(a["data-t"])
        if a.get("data-t-aria"):
            self.keys.add(a["data-t-aria"])
        if a.get("data-l") in self.langs:
            self.langs[a["data-l"]] += 1
        if tag == "script" and "src" not in a:
            self._script = []
        if tag not in VOID:
            self.stack.append((tag, line))

    def handle_startendtag(self, tag, attrs):
        if tag in VOID or tag in SVG_SELF:
            self.handle_starttag(tag, attrs)
            if tag not in VOID:
                self.stack.pop()
        else:
            self.problems.append(f"{self.getpos()[0]}: <{tag}/> nie jest pustym elementem")

    def handle_endtag(self, tag):
        if tag == "script" and self._script is not None:
            self.scripts.append("".join(self._script))
            self._script = None
        if not self.stack or self.stack[-1][0] != tag:
            open_ = self.stack[-1] if self.stack else ("—", 0)
            self.problems.append(f"{self.getpos()[0]}: </{tag}> zamyka <{open_[0]}> z wiersza {open_[1]}")
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    del self.stack[i:]
                    break
            return
        self.stack.pop()

    def handle_data(self, data):
        if self._script is not None:
            self._script.append(data)


def resolve(path: str) -> pathlib.Path | None:
    """Plik, który Cloudflare Pages poda dla adresu (bez przekierowań z _redirects)."""
    p = path.lstrip("/")
    cands = [SITE / p / "index.html"] if p == "" or p.endswith("/") else [SITE / p, SITE / f"{p}.html", SITE / p / "index.html"]
    return next((c for c in cands if c.is_file()), None)


def main() -> int:
    headers = (SITE / "_headers").read_text()
    csp_hashes = set(re.findall(r"'sha256-([A-Za-z0-9+/=]+)'", headers))
    js = (SITE / "assets/site.js").read_text()
    en_keys = set(re.findall(r'"([a-z0-9.]+)":', js))
    svg_ids: dict[pathlib.Path, set[str]] = {}

    pages = sorted(SITE.rglob("*.html"))
    for f in pages:
        rel = f.relative_to(SITE)
        p = Page()
        p.feed(f.read_text())
        p.close()
        for m in p.problems:
            err(f"{rel}:{m}")
        for tag, line in p.stack:
            if tag not in ("html", "body", "head"):
                err(f"{rel}:{line}: <{tag}> bez zamknięcia")
        for s in p.scripts:
            h = base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()
            if h not in csp_hashes:
                err(f"{rel}: skrypt inline {s[:40]!r} ma sha256-{h}, którego nie ma w CSP w _headers")
        for k in sorted(p.keys - en_keys):
            err(f"{rel}: klucz data-t „{k}” nie ma tłumaczenia w assets/site.js")
        if p.langs["pl"] != p.langs["en"]:
            err(f"{rel}: bloków data-l pl={p.langs['pl']}, en={p.langs['en']}")
        for ref, line in p.refs:
            if ref.startswith(("https://", "http://", "mailto:")):
                continue
            url, _, frag = ref.partition("#")
            url = url.split("?")[0]
            if not url:
                if frag and frag not in p.ids and frag != "top":
                    err(f"{rel}:{line}: kotwica #{frag} nie istnieje")
                continue
            if not url.startswith("/"):
                err(f"{rel}:{line}: adres względny {ref!r} (strona używa adresów od /)")
                continue
            if url == "/download":
                continue  # przekierowanie do .exe albo strona download/ (_redirects)
            target = resolve(url)
            if target is None:
                err(f"{rel}:{line}: {ref} nie prowadzi do pliku")
            elif frag and target.suffix == ".svg":
                ids = svg_ids.setdefault(target, set(re.findall(r'\bid="([^"]+)"', target.read_text())))
                if frag not in ids:
                    err(f"{rel}:{line}: {ref}: w pliku nie ma id „{frag}”")

    cfg = json.loads(HELP.read_text())
    base = cfg["base"].rstrip("/")
    sitemap = (SITE / "sitemap.xml").read_text()
    for topic, path in cfg["topics"].items():
        if not (SITE / "help" / f"{path}.html").is_file():
            err(f"help.json: temat „{topic}” → /help/{path}, brak pliku help/{path}.html")
        if f"<loc>{base}/{path}</loc>" not in sitemap:
            err(f"sitemap.xml: brak {base}/{path}")

    redirects = (SITE / "_redirects").read_text()
    for line in redirects.splitlines():
        parts = line.split()
        if parts and not line.startswith("#") and parts[0].rstrip("*").startswith("/help/"):
            err(f"_redirects: reguła {parts[0]} zasłania strony pomocy (przekierowania mają pierwszeństwo przed plikami)")

    for e in errors:
        print(f"BŁĄD {e}")
    print(f"Strona: {len(pages)} stron, {len(cfg['topics'])} tematów pomocy, {'OK' if not errors else f'{len(errors)} błędów'}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
