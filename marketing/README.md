# RowTracer marketing pipeline

Assets in `marketing/` are repo-only: never deployed, never cached by the service
worker, never counted by the app-size guards.

## How posting works

1. **Generate** — Claude produces the post (real Demo Mode captures, synthetic data
   only) into `marketing/instagram/`, commits, and pushes. Ask for "a launch post" /
   "a feature post" or schedule it per release.
2. **Approve** — a human reviews the PNG + caption, then creates the approval marker:
   `copy nul marketing\instagram\<name>.png.APPROVED` (or pass `--yes`).
3. **Publish** — `npm run ig:publish` calls the Instagram Graph API. No browser
   automation, no password bots (those violate Instagram ToS).

## One-time owner setup (Claude cannot and will not do these)

1. Convert the Instagram account to **Business/Creator** and link it to a Facebook Page.
2. Create a **Meta developer app**; add Instagram Graph API; grant
   `instagram_content_publish`; generate a **long-lived Page access token**.
3. Find the Instagram Business **user id** (Graph Explorer: `me/accounts` →
   `?fields=instagram_business_account`).
4. Set environment variables (never committed, never shared in chat):
   `setx ROWTRACER_IG_TOKEN "<token>"` and `setx ROWTRACER_IG_USER_ID "<id>"`.

The publish script reads them from the environment only, redacts the token from any
error output, and refuses to run without the approval marker. The image must be pushed
to `origin/main` first (the API fetches it from raw.githubusercontent.com).

## Commands

```bash
# preview what would be posted (no token needed)
npm run ig:publish -- --dry-run

# publish an approved post
npm run ig:publish
```

Defaults point at the current launch post; override with
`--image <path> --caption <file>`.
