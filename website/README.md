# sindrava documentation site

Source of <https://sindrava.bzy-logics.com>, built with [VitePress](https://vitepress.dev). Deployed to GitHub Pages by [`.github/workflows/docs.yml`](../.github/workflows/docs.yml) on every push to `main` that touches `website/`.

This is a separate npm project from the app; it has its own `package.json` and lockfile.

```sh
cd website
npm install
npm run dev        # dev server with hot reload (uses the next free port if the app holds 5173)
npm run build      # static site in .vitepress/dist/; fails on dead internal links
npm run preview
```

**Windows:** build from a path with an uppercase drive letter (`cd D:\…\website`). From `d:\…`, VitePress fails while rendering with `Cannot read properties of undefined (reading 'imports')`.

## Keeping it accurate

| Page | Source of truth |
|---|---|
| `guide/screens.md` | `src/features/*`, `src/app/tabs.ts` |
| `guide/safety.md` | `src/hooks/status.ts`, `src/app/App.tsx`, `src/api/backoff.ts` |
| `guide/authentication.md` | `src/api/auth.ts`, `src/api/ws.ts` |
| `development/api-client.md` | `src/api/*`, `src/hooks/*` |

Sibling sites: [motioncore.bzy-logics.com](https://motioncore.bzy-logics.com), [ratavyr.bzy-logics.com](https://ratavyr.bzy-logics.com).

## Deployment setup (once)

1. Repository **Settings → Pages → Source: GitHub Actions**.
2. **Custom domain** `sindrava.bzy-logics.com`, then **Enforce HTTPS**.
3. DNS: `CNAME sindrava → bzy-logics.github.io`.
