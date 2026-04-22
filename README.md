# autoreply

A Discord bot that auto-replies to common repeat questions (e.g. "how do I create an account?", "is the server down?") by pointing users to your announcements channel.

Admins can add or remove trigger phrases, add ignore rules for false positives, and edit the reply text — all from Discord via slash commands. Config is stored in a JSON file so it survives restarts and redeploys.

---

## Features

- Keyword-based triggers with per-slot alternatives (e.g. `account|acount create|make` matches any combination)
- Per-user, per-channel 5-minute cooldown so users aren't spammed with replies
- Runtime configuration via slash commands (Manage Server permission required)
- `{channel}` placeholder in the reply text automatically renders as a clickable channel mention
- JSON persistence — easy to inspect, back up, or edit manually

---

## Setting up the Discord side

### 1. Create the application and bot

1. Go to <https://discord.com/developers/applications> and sign in.
2. **New Application** → name it → accept terms.
3. Left sidebar → **Bot**.
4. Scroll to **Privileged Gateway Intents** and enable **Message Content Intent**. Save changes.
5. Near the top of the Bot page, click **Reset Token** → **Copy**. Save this — you'll need it for `DISCORD_TOKEN`.

> ⚠ Treat the token like a password. If it's ever exposed, click Reset Token again — the old one becomes invalid.

### 2. Invite the bot to your server

1. Left sidebar → **OAuth2** → **URL Generator**.
2. Under **Scopes**, check `bot` and `applications.commands`.
3. Under **Bot Permissions**, check:
   - View Channels
   - Send Messages
   - Read Message History
4. Copy the generated URL, open it, choose your server, authorize.

### 3. Grab the announcement channel ID

1. In Discord, enable Developer Mode: **User Settings → Advanced → Developer Mode** ON.
2. Right-click your announcement channel → **Copy Channel ID**.
3. Make sure the bot has **View Channel** permission on that channel — otherwise mentions render as `#unknown`.

---

## Running locally

Requires Node.js 18+.

```bash
git clone https://github.com/emprilia/autoreply.git
cd autoreply
npm install
cp .env.example .env
# edit .env and fill in DISCORD_TOKEN and ANNOUNCEMENT_CHANNEL_ID
npm start
```

You should see `Logged in as <botname>` followed by `Slash commands registered globally`.

The bot writes its runtime config to `./data/config.json`. This directory is gitignored.

---

## Deploying to Railway

### 1. Deploy the repo

1. Sign in to <https://railway.app> with GitHub.
2. **New Project** → **Deploy from GitHub repo** → pick `autoreply`.
3. First build will fail (no token yet) — that's expected.

### 2. Add environment variables

Open the service → **Variables** tab → add:

| Key                       | Value                                 |
| ------------------------- | ------------------------------------- |
| `DISCORD_TOKEN`           | Your bot token                        |
| `ANNOUNCEMENT_CHANNEL_ID` | Your announcement channel ID          |
| `DATA_DIR`                | `/data` (matches the volume mount)    |

### 3. Attach a persistent volume

Without this, custom triggers are wiped on every redeploy.

1. Service → **Volumes** (or Settings → Volumes in newer UIs).
2. **+ New Volume** → mount path `/data` → save.
3. Railway redeploys automatically.

Watch the **Deployments → Logs** tab for `Logged in as ...` to confirm.

---

## Slash commands

All commands require **Manage Server** permission. Global slash commands can take a minute or two to appear in Discord the first time the bot starts.

### Triggers — what the bot replies to

A trigger is a list of **slots** (space-separated words). A message matches the trigger only if every slot finds at least one of its alternatives present as a whole word.

Alternatives within a slot are separated by `|`.

```
/trigger add keywords:account|acount create|make|register
```

That matches messages containing (`account` OR `acount`) AND (`create` OR `make` OR `register`).

| Command                           | What it does                                  |
| --------------------------------- | --------------------------------------------- |
| `/trigger add keywords:<string>`  | Add a new trigger                             |
| `/trigger remove id:<number>`     | Delete a trigger by ID                        |
| `/trigger list`                   | Show all triggers with their IDs              |

### Ignore rules — suppress false positives

Same syntax as triggers. If a message matches **any** ignore rule, the bot stays silent even if it also matches a trigger.

```
/ignore add keywords:free account
```

| Command                          | What it does                        |
| -------------------------------- | ----------------------------------- |
| `/ignore add keywords:<string>`  | Add an ignore rule                  |
| `/ignore remove id:<number>`     | Delete an ignore rule by ID         |
| `/ignore list`                   | Show all ignore rules with IDs      |

### Reply text

```
/reply set text:Check {channel} for how to create an account.
```

`{channel}` is replaced at send time with the mention of the channel whose ID is in `ANNOUNCEMENT_CHANNEL_ID`.

| Command                   | What it does                         |
| ------------------------- | ------------------------------------ |
| `/reply set text:<text>`  | Change the reply message             |
| `/reply show`             | Print the current reply text         |

---

## Configuration reference

### Environment variables

| Variable                  | Required | Default   | Notes                                              |
| ------------------------- | -------- | --------- | -------------------------------------------------- |
| `DISCORD_TOKEN`           | yes      | —         | Bot token from the Discord Developer Portal        |
| `ANNOUNCEMENT_CHANNEL_ID` | no       | —         | Used to render `{channel}` in replies              |
| `DATA_DIR`                | no       | `./data`  | Where `config.json` lives. Set to `/data` on Railway |

### `data/config.json` structure

```jsonc
{
  "replyText": "Hi! ... please check {channel} ...",
  "triggers": [
    { "id": 1, "keywords": [["account", "acount"], ["create", "make"]] }
  ],
  "ignores": [
    { "id": 1, "keywords": [["free"], ["account"]] }
  ],
  "nextTriggerId": 2,
  "nextIgnoreId": 2
}
```

You can edit this file directly if you prefer — just restart the bot afterward. On Railway, edits via slash command are the practical path since the file lives on the mounted volume.

---

## Project layout

```
autoreply/
├── index.js          # the entire bot: matcher, message handler, slash commands
├── package.json
├── .env.example
├── .gitignore
└── data/             # created at runtime; holds config.json (gitignored)
```

---

## Troubleshooting

- **Bot replies with `#unknown` channel mention** — the ID in `ANNOUNCEMENT_CHANNEL_ID` is wrong, or the bot lacks **View Channel** permission on that channel.
- **Slash commands don't show up** — wait ~5 minutes after first start (global commands propagate slowly), then restart the Discord client.
- **Nothing happens when a user sends a trigger message** — check the process logs. Common causes: bot isn't running, Message Content Intent not enabled in the Developer Portal, or the bot lacks Send Messages in that channel.
- **Triggers vanish after a Railway redeploy** — the volume isn't mounted or `DATA_DIR` isn't set to `/data`.
