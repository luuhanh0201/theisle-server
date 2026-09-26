# Discord relay (Cloudflare Worker)

Off the VPS: the bridge sends it a heartbeat every 2 minutes; when the VPS goes
quiet (down, cut off, DDoS) the Worker posts "Mất kết nối" on Discord and
"Kết nối lại" when it is back. `/status` and `/online` in Discord are answered
here, from the last heartbeat. Source: `src/index.ts`, tests: `npm test`.

Setup (once):

1. `npx wrangler login`
2. `npx wrangler kv namespace create STATE` → put the id in `wrangler.toml`
3. `npx wrangler secret put BRIDGE_SECRET` (a long random string)
4. Discord Developer Portal → New Application → copy the **Public Key** into
   `wrangler.toml` (`DISCORD_PUBLIC_KEY`), `npx wrangler deploy`
5. Portal → General Information → **Interactions Endpoint URL** =
   `https://<worker>.workers.dev/interactions`
6. Panel → Quản trị → Discord → Trạm ngoài VPS: the Worker URL + the same
   secret; then "Đăng ký lệnh" with the Application ID and the bot token
7. Invite the application: `https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=applications.commands`
