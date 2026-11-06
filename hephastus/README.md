# Hephastus

Your personal AI assistant, in your web browser, powered by Claude.

You open your private Hephastus page, log in with your password, and chat. It remembers what you tell it, searches the web when it needs current information, and works on your phone and computer.

## What it costs

| Part | What it does | Cost |
|---|---|---|
| Render | Runs Hephastus and gives it a web address | Free plan |
| Upstash | Stores memory and chat history | Free plan |
| Claude API (Anthropic) | The brain | **Pay per use, not free.** Prepaid credit, from $5. |

How much Claude costs depends on the model (the `MODEL` setting):

- `claude-opus-5-5` (default, smartest): roughly 1 to 3 US cents per message.
- `claude-haiku-5-5` (fastest, cheapest): a fraction of a cent per message, about 40 times cheaper.
- Each web search adds about 1 cent.

You can switch models at any time; see "Change settings" below.

## Set it up (about 15 minutes)

You'll create three free accounts. Keep a note open to paste values into as you go.

### 1. Claude API key

1. Go to https://console.anthropic.com and sign up.
2. Open **Billing** and add credit ($5 is plenty to start).
3. Open **API keys**, then **Create key**. Copy it. This is `ANTHROPIC_API_KEY`.

### 2. Upstash (memory storage)

1. Go to https://upstash.com and sign up (free, no card needed).
2. **Create Database**, type **Redis**, pick the region closest to you (Frankfurt for Egypt or Europe).
3. On the database page, find **REST API**. Copy the URL (`UPSTASH_REDIS_REST_URL`) and the token (`UPSTASH_REDIS_REST_TOKEN`).

### 3. Choose a password

Make up a long password for your Hephastus page. This is `APP_PASSWORD`. Anyone with it can chat as you and read your history, so use something you don't use elsewhere, at least 12 characters.

### 4. Deploy on Render

1. Go to https://render.com and sign up with your GitHub account.
2. Click **New > Blueprint** and choose the `hephastus` repository. Render reads `render.yaml` and asks for the values you collected. Paste each one.
3. Click **Deploy** and wait a few minutes.
4. Render shows your address, like `https://hephastus-xxxx.onrender.com`. Open it, log in with your password, and say hi.

Bookmark the address. On a phone, use your browser's **Add to Home Screen** to get an app-like icon.

## Using it

- Type a message and press **Enter** (on a computer) or the arrow button. **Shift+Enter** adds a new line.
- Tell it "remember that…" to save something.
- **Memory** shows everything it remembers; tap **Forget** to remove one.
- **New chat** clears the conversation but keeps the memory.
- You stay logged in for 30 days on each device.

## Good to know

- **First load after a quiet spell is slow.** Render's free plan pauses the service after 15 minutes with no use. Opening the page wakes it up, which takes about a minute. After that it's quick.
- **Text only for now.** Next steps: email, calendar, files and your own documents, as planned in the diagram.
- **Security:** only someone with your password can use it. After 10 wrong passwords, logins pause for 15 minutes.

## Change settings

In Render, open the service's **Environment** tab, change a value, and save. Render restarts Hephastus automatically.

| Setting | Meaning | Default |
|---|---|---|
| `MODEL` | Which Claude model to use | `claude-opus-5-5` |
| `EFFORT` | How hard Claude thinks: `low`, `medium`, `high` | `medium` |
| `HISTORY_LIMIT` | How many recent messages it keeps in the conversation | `40` |
| `APP_PASSWORD` | Your login password | (you choose) |

Changing `SESSION_SECRET` logs out every device.

## For developers

```bash
cd hephastus
npm install
npm test
ANTHROPIC_API_KEY=... APP_PASSWORD=... SESSION_SECRET=any-long-random-text npm start
```

Then open http://localhost:3000. Without the Upstash settings, Hephastus stores its state in `./data/state.json` (or `DATA_DIR`). The code is in `src/`: `server.js` (web server, login, API), `assistant.js` (Claude), `store.js` (storage); the chat page is `public/index.html`.
