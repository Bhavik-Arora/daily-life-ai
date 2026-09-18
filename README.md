# Daily Life

A privacy-first, companion-style life hub with chat, voice, routines, calendar, streaks, and tiered conversation controls.

## Run locally

1. Install Node 20+ and a working npm installation.
2. Copy `.env.example` to `.env` and set `DATA_ENCRYPTION_KEY` (a 32-byte base64 key).
3. Run `npm start`, then open `http://localhost:3000`.

No package installation is required—the app uses Node's built-in server and browser APIs.

## Google sign-in

Create Google OAuth web credentials, add the redirect URI from `GOOGLE_REDIRECT_URI`, and supply `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`. For a mobile shell, register `life.daily.app://auth/callback` with your identity provider and route it to the same authenticated session exchange.

## Anthropic companion connection

Set `ANTHROPIC_API_KEY` and, if desired, override the three `ANTHROPIC_MODEL_*` tier variables. The key stays on the server and is never sent to the browser. The selected tier determines the Claude model; the Effort Bar becomes the per-message output budget. With no API key, the companion remains usable in local-demo mode.

## Privacy notes

In development, the file adapter encrypts user data and messages with AES-256-GCM before writing `data/daily-life.enc`; its encryption key is never stored alongside the data. Production deployments should implement `db/schema.sql` with parameterized queries, store the encryption key in a managed secret store, use a per-user data-encryption-key envelope, and add durable session storage plus CSRF protection.
