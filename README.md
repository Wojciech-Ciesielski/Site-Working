# Site-Working

Repozytorium robocze strony **shrimp-organization.dev** (Cloudflare Pages, bez kroku budowy). Strona nie ma wydań: każda zmiana na `main` to wdrożenie.

- Kod: `boxes/site/` (katalog wyjściowy Cloudflare Pages: `boxes/site`). Wdrożenie: Cloudflare Workers (projekt `site`, `wrangler.jsonc`): pliki z R2 pod `/download/<plik>` (`boxes/site/_worker.js`). Pobieranie programu: jedna linia w `boxes/site/_redirects`.
- Adresy pomocy z aplikacji: box `help-links` (`help.json`). To repozytorium jest jego źródłem; kopie są w Shrimps-Working i Install-Working.
- Sprawdzenie przed wdrożeniem: workflow **Strona** (`tools/check-site.py`, Cloudflare Pages lokalnie).

Kopie wspólnych boxów (zmieniaj najpierw w źródle): `shrimp-box` → CoreOS-Working; `help-links` → tutaj.

Zasady boxów: [`boxes/README.md`](boxes/README.md), sprawdzenie `cd boxes/shrimp-box && cargo run -- check` (workflow **Boxy**). Żaden PR nie dodaje zrzutów ekranu ani `test-results/` (workflow **Bez zrzutów**).
