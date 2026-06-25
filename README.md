# FileHub

FileHub is a small private web server for publishing local files through clean links.

## Features

- First-run setup wizard with username/password auth
- No password recovery path
- Upload from a file picker or drag and drop
- Direct links such as `http://localhost:2767/archive.zip`
- Path links such as `http://localhost:2767/archive`
- Public files download directly
- Private files require a temporary query-string key
- Temporary access keys expire after 5 minutes
- Docker image with separate public, private, and data volumes

## Local development

Requires Node.js 22+ and pnpm 11+.

```bash
corepack enable
pnpm install
pnpm dev
```

The app runs at [http://localhost:5173](http://localhost:5173) in development and proxies API calls to the backend on port `2767`.

```bash
pnpm test
pnpm build
```

## Docker

Copy `.env.example` to `.env`, then replace `SESSION_SECRET` with a stable random value.

Build and start FileHub with Docker bridge networking:

```bash
docker compose --project-name file-hub up --build -d
```

FileHub is available at [http://localhost:2767](http://localhost:2767).

Or build and start FileHub with host networking:

```bash
docker compose --project-name file-hub -f compose.host.yaml up --build -d
```

The Compose file reads `.env` and mounts three host-backed volumes:

- `DATA_PATH` for account metadata and file records
- `PUBLIC_FILE_PATH` for public uploads
- `PRIVATE_FILE_PATH` for private uploads

Each uploaded file also gets a sidecar metadata file beside it, named like `example.zip.filehub.json`. Those files contain the route mode, visibility, original filename, stored filename, MIME type, and creation time, so the file-serving configuration can be recovered from the public/private folders even if the container and main data file are removed.

Remove the bridge-networked Docker resources:

```bash
docker compose --project-name file-hub down --volumes --rmi all --remove-orphans
```

Remove the host-networked Docker resources:

```bash
docker compose --project-name file-hub -f compose.host.yaml down --volumes --rmi all --remove-orphans
```

For a reverse proxy, forward the public HTTPS subdomain to port `2767`. `NODE_ENV=production` makes the session cookie HTTPS-only, so keep HTTPS enabled on the public subdomain.
