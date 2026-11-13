// Pobieranie plików wydań z R2 pod adresem https://shrimp-organization.dev/download/<plik>
// (np. /download/beta-5/Shrimp.x86_64-0.1.0.iso, /download/manifest.json). Bez osobnej domeny.
// Wymaga powiązania R2 w projekcie Pages: nazwa zmiennej SHRIMP_ISO, kubeł site-iso-download.
// _routes.json kieruje tu tylko /download/*; /download/ i /download/install to zwykłe strony.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/download/")) return env.ASSETS.fetch(request);
    const key = decodeURIComponent(url.pathname.slice("/download/".length));
    if (!key || key.endsWith("/") || !env.SHRIMP_ISO) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }

    const head = await env.SHRIMP_ISO.head(key);
    if (!head) return env.ASSETS.fetch(request);

    const headers = new Headers();
    head.writeHttpMetadata(headers);
    headers.set("etag", head.httpEtag);
    headers.set("accept-ranges", "bytes");
    headers.set("cache-control", key.endsWith(".json") ? "public, max-age=60" : "public, max-age=3600");
    if (key.endsWith(".iso")) headers.set("content-disposition", `attachment; filename="${key.split("/").pop()}"`);

    if (request.method === "HEAD") {
      headers.set("content-length", String(head.size));
      return new Response(null, { headers });
    }

    const obj = await env.SHRIMP_ISO.get(key, { range: request.headers, onlyIf: request.headers });
    if (!("body" in obj)) return new Response(null, { status: 304, headers });
    const r = obj.range;
    if (r && request.headers.has("range")) {
      const start = r.offset ?? (r.suffix !== undefined ? head.size - r.suffix : 0);
      const len = r.length ?? (r.suffix ?? head.size - start);
      headers.set("content-range", `bytes ${start}-${start + len - 1}/${head.size}`);
      headers.set("content-length", String(len));
      return new Response(obj.body, { status: 206, headers });
    }
    headers.set("content-length", String(head.size));
    return new Response(obj.body, { headers });
  },
};
