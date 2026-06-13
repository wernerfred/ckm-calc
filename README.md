# ckm-calc

Mobile-first cash register web app for CKM with variants (`Punsch`, `Cocktail`, `Würstel`), admin editing, and offline-capable frontend caching.

## Local Run

```bash
ADMIN_PASSWORD='change-me' node app/server.js
```

Open: `http://localhost:8080`

## Docker (recommended)

Build:

```bash
docker build -t ckm-calc .
```

Run with persistent admin configuration storage:

```bash
docker run --rm -p 8080:8080 -e ADMIN_PASSWORD='change-me' -v "$(pwd)/data:/data" ckm-calc
```

Open: `http://localhost:8080`

Notes:

- Admin catalog changes are written to `/data/catalogs.json` inside the container.
- By mounting `$(pwd)/data:/data`, changes survive container restarts/redeploys.
- Admin pages are password-protected. The password is provided via `ADMIN_PASSWORD` at container start.
- Frontend service worker cache keeps the app usable during short connectivity loss.

## Pages

- `/` launcher
- `/punsch.html`, `/cocktail.html`, `/wurstel.html` calculator variants
- `/admin.html` admin launcher
- `/admin-edit.html?calc=punsch|cocktail|wurstel` item editor
