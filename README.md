# GreedSeek

Static map app for Netlify deployment.

## No External APIs

- No `/api/*` route handlers are used.
- No third-party API fetch calls are used by the app runtime.
- App data is loaded from local static files under `public/data/*` (for example `/data/pois.geojson` and `/data/geo/*.geojson`).

## Allowed Network Domains (tiles only)

The only allowed external network domain in runtime is:

- `https://tiles.openfreemap.org`

This domain is used for basemap vector tiles and glyphs. All other absolute `fetch` URLs are blocked by a client-side fetch guard.

## Local Dev

```bash
npm run dev
```
