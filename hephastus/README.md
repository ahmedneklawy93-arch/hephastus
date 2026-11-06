# Hephastus

Your personal AI assistant on WhatsApp, powered by Claude.

You message Hephastus on WhatsApp and it answers. It remembers what you tell it, searches the web when it needs current information, and only ever talks to your own phone number.

## What it costs

| Part | What it does | Cost |
|---|---|---|
| WhatsApp Cloud API (Meta) | Delivers your messages | Free. Replies to messages you send are free. |
| Render | Runs Hephastus 24/7 | Free plan |
| Upstash | Stores memory and chat history | Free plan |
| Claude API (Anthropic) | The brain | **Pay per use, not free.** Prepaid credit, from $5. |

How much Claude costs depends on the model (the `MODEL` setting):

- `claude-opus-5-5` (default, smartest): roughly 1 to 3 US cents per message.
- `claude-haiku-5-5` (fastest, cheapest): a fraction of a cent per message, about 40 times cheaper.
- Each web search adds about 1 cent.

You can switch models at any time; see "Change settings" below.

## Set it up (about 30 minutes)

You'll create four free accounts and copy some values into Render. Keep a note open to paste values into as you go.

### 1. Claude API key

1. Go to https://console.anthropic.com and sign up.
2. Open **Billing** and add credit ($5 is plenty to start).
3. Open **API keys**, then **Create key**. Copy it. This is `ANTHROPIC_API_KEY`.

### 2. Upstash (memory storage)

1. Go to https://upstash.com and sign up (free, no card needed).
2. **Create Database**, type **Redis**, pick the region closest to you (Frankfurt for Egypt or Europe).
3. On the database page, find **REST API**. Copy the URL (`UPSTASH_REDIS_REST_URL`) and the token (`UPSTASH_REDIS_REST_TOKEN`).

### 3. WhatsApp (Meta)

1. Go to https://developers.facebook.com, log in with Facebook, and **Create App**. Choose the use case **Connect with customers through WhatsApp**, then follow the prompts to create or pick a business portfolio.
2. In the app, open **WhatsApp > API Setup**. Meta gives you a free **test phone number**. This is the number you'll chat with.
   - Copy the **Phone number ID**. This is `WHATSAPP_PHONE_NUMBER_ID`.
   - Under **To**, add **your own WhatsApp number** and confirm it with the code WhatsApp sends you.
3. Your number in international format, digits only (for example `201001234567` for +20 100 123 4567), is `OWNER_WHATSAPP_NUMBER`. Hephastus ignores everyone else.
4. Open **App settings > Basic** and click **Show** next to App secret. This is `WHATSAPP_APP_SECRET`.
5. Create a token that doesn't expire (the one on the API Setup page only lasts 24 hours):
   1. Go to https://business.facebook.com/settings, then **Users > System users > Add**. Give it any name and the **Admin** role.
   2. Click **Assign assets**, choose your app, and give it **Full control**.
   3. Click **Generate token**, pick your app, set expiry to **Never**, and tick `whatsapp_business_messaging` and `whatsapp_business_management`.
   4. Copy the token. This is `WHATSAPP_TOKEN`.

### 4. Deploy on Render

1. Go to https://render.com and sign up with your GitHub account.
2. Click **New > Blueprint** and choose the `hephastus` repository. Render reads `render.yaml` and asks for the values you collected. Paste each one.
3. Click **Deploy**. When it's live, Render shows an address like `https://hephastus-xxxx.onrender.com`. Opening it should say "Hephastus is running."
4. In Render, open the service's **Environment** tab and copy the value of `WHATSAPP_VERIFY_TOKEN` (Render generated it for you).

### 5. Connect WhatsApp to Hephastus

1. Back in Meta, open **WhatsApp > Configuration**, then **Webhook > Edit**.
   - Callback URL: your Render address followed by `/webhook`, for example `https://hephastus-xxxx.onrender.com/webhook`
   - Verify token: the `WHATSAPP_VERIFY_TOKEN` from Render
2. Click **Verify and save**, then click **Manage** under webhook fields and **Subscribe** to `messages`.
3. Save Meta's test number in your phone's contacts and send it "hi" on WhatsApp. Hephastus should answer.

## Using it

Just chat. You can also send:

- `/memory`: see what Hephastus remembers about you
- `/reset`: clear the conversation (memory is kept)
- `/help`: list the commands

Tell it "remember that…" to save something; "forget…" to remove it.

## Good to know

- **First reply after a quiet spell is slow.** Render's free plan pauses the service after 15 minutes with no messages. The next message wakes it up, which takes about a minute. Later replies are quick.
- **Text only for now.** Photos, voice notes and documents get a polite "text only" reply.
- **Step 2, coming next:** email, calendar, files and your own documents, as planned in the diagram.

## Change settings

In Render, open the service's **Environment** tab, change a value, and save. Render restarts Hephastus automatically.

| Setting | Meaning | Default |
|---|---|---|
| `MODEL` | Which Claude model to use | `claude-opus-5-5` |
| `EFFORT` | How hard Claude thinks: `low`, `medium`, `high` | `medium` |
| `HISTORY_LIMIT` | How many recent messages it keeps in the conversation | `40` |

## For developers

```bash
cd hephastus
npm install
npm test
```

Without the Upstash settings, Hephastus stores its state in `./data/state.json` (or `DATA_DIR`). The code is in `src/`: `server.js` (webhook), `handler.js` (commands, owner check), `assistant.js` (Claude), `whatsapp.js` (Cloud API), `store.js` (storage).
