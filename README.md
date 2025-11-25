# p5-llm-proxy

A local proxy server for the Google Gemini API that bypasses CORS issues in web editors like p5.js.

## Why?

When building AI-powered sketches in the [p5.js web editor](https://editor.p5js.org/) or similar browser-based environments, you'll encounter CORS errors when trying to call the Gemini API directly. This proxy:

- Runs locally on your machine
- Creates a public HTTPS URL via ngrok
- Handles all CORS headers automatically
- Securely injects your API key (so you don't expose it in client-side code)

## Features

- 🌐 **Built-in ngrok** — Automatically creates a public HTTPS URL that works with p5.js web editor
- 🔓 **CORS bypass** — Enables Gemini API calls from any browser-based editor
- 🔑 **Secure key injection** — Your API key stays on your machine, not in your sketch
- 💬 **Interactive setup** — Guides you through getting ngrok token and API key
- 📝 **Request logging** — See all proxied requests in your terminal
- ⚡ **Zero config** — Works out of the box with sensible defaults

## Quick Start

### Prerequisites

1. **ngrok token** (free): https://dashboard.ngrok.com/get-started/your-authtoken
2. **Gemini API key** (free): https://aistudio.google.com/apikey

### Run

```bash
npx p5-llm-proxy
```

The tool will guide you through setup:

```
╔════════════════════════════════════╗
║         p5-llm-proxy               ║
║   Gemini API Proxy for p5.js       ║
╚════════════════════════════════════╝

🌐 ngrok token required for public URL

To get your free ngrok token:
  1. Sign up at https://ngrok.com (free)
  2. Go to https://dashboard.ngrok.com/get-started/your-authtoken
  3. Copy your authtoken

Enter your ngrok auth token: █
```

Once setup is complete, you'll see your public URL:

```
═══════════════════════════════════════════════════════════════

🎉 Proxy is ready!

   Public URL (use this in p5.js):
   https://abc123.ngrok-free.app

═══════════════════════════════════════════════════════════════
```

## Usage with Command Line Arguments

Skip the interactive prompts by providing arguments:

```bash
npx p5-llm-proxy --token YOUR_NGROK_TOKEN --key YOUR_GEMINI_KEY
```

### Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--token <token>` | `-t` | Your ngrok auth token | (prompted) |
| `--key <key>` | `-k` | Your Google Gemini API key | (prompted) |
| `--port <number>` | `-p` | Port to run the proxy on | `8000` |
| `--local` | `-l` | Local mode only (no ngrok tunnel) | `false` |
| `--https` | `-s` | Enable HTTPS with self-signed cert (local only) | `false` |

## Example: Using with p5.js

Copy the URL shown by the tool and use it in your p5.js sketch:

```javascript
// Replace with the URL shown by p5-llm-proxy
const PROXY_URL = 'https://abc123.ngrok-free.app';

async function askGemini(prompt) {
  const response = await fetch(`${PROXY_URL}/v1beta/models/gemini-2.5-flash:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'  // Required for ngrok free tier
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  });

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

// Usage in your sketch
async function setup() {
  createCanvas(400, 400);
  const answer = await askGemini('Write a haiku about creative coding');
  console.log(answer);
}
```

### Important: ngrok-skip-browser-warning Header

When using ngrok's free tier, you **must** include the `ngrok-skip-browser-warning` header in your fetch requests. Without this header, ngrok will return an HTML warning page instead of proxying your request.

```javascript
headers: {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true'  // Don't forget this!
}
```

### Streaming Responses

```javascript
async function streamGemini(prompt) {
  const response = await fetch(`${PROXY_URL}/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }]
      }]
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    // Process SSE data
    console.log(chunk);
  }
}
```

## Supported Models

The proxy works with all Gemini API models, including:

| Model | Description |
|-------|-------------|
| `gemini-2.5-pro` | Advanced reasoning and thinking |
| `gemini-2.5-flash` | Fast and efficient |

## Supported Endpoints

All `/v1beta/*` endpoints are proxied, including:

- `generateContent` — Standard content generation
- `streamGenerateContent` — Streaming responses
- `countTokens` — Token counting
- `models` — List available models
- `embedContent` — Generate embeddings

## Get Your Tokens

### ngrok Auth Token (free)
1. Sign up at [ngrok.com](https://ngrok.com)
2. Go to [Your Authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Copy the token

### Gemini API Key (free)
1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Click "Create API Key"
3. Copy the key

## Troubleshooting

### "Failed to fetch" or Network Error
- Make sure the proxy is running in your terminal
- Check that you're using the correct ngrok URL (it changes each session)
- Verify the `ngrok-skip-browser-warning` header is included

### 404 Error
- Ensure the URL path starts with `/v1beta/`
- Check that the model name is correct (e.g., `gemini-2.5-flash`)

### Empty Response / JSON Parse Error
- Check the terminal for error messages (red `← 4xx` status codes)
- Verify your Gemini API key is valid
- Make sure you didn't accidentally paste the ngrok token as the API key

### ngrok Error
- Verify your ngrok auth token is correct
- Check if you've exceeded ngrok's free tier limits
- Try restarting the proxy

### CORS Error in Browser
- This shouldn't happen if using ngrok - make sure you're using the ngrok URL
- If using `--local` or `--https` mode, these don't work with the p5.js web editor

## Security Notes

- Your API key is only stored in memory while the proxy runs
- The key is never sent to the client/browser
- Only requests to `/v1beta/*` are proxied
- ngrok URLs are randomly generated and change each session
- The API key is injected via the `x-goog-api-key` header (official method)

## Local Mode

If you don't want to use ngrok (e.g., for local development with your own server):

```bash
# HTTP only (won't work with p5.js web editor)
npx p5-llm-proxy --local

# HTTPS with self-signed cert (for local browser testing)
npx p5-llm-proxy --https
```

**Note:** Local modes don't work with the p5.js web editor due to browser security restrictions (Private Network Access policy).

## How It Works

1. The proxy starts an Express server on your local machine
2. ngrok creates a secure tunnel from a public URL to your local server
3. When p5.js makes a request to the ngrok URL:
   - The request goes through ngrok's servers to your local proxy
   - The proxy adds your API key via the `x-goog-api-key` header
   - The proxy forwards the request to `generativelanguage.googleapis.com`
   - The response is sent back through the same path with CORS headers added

## License

MIT
