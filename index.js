#!/usr/bin/env node

/**
 * p5-llm-proxy
 * 
 * A local proxy server for the Google Gemini API that bypasses CORS issues
 * in web editors like p5.js. Features built-in ngrok integration for creating
 * public HTTPS URLs that work with browser-based editors.
 * 
 * Usage:
 *   npx p5-llm-proxy                    # Interactive mode with ngrok
 *   npx p5-llm-proxy --local            # Local HTTP only
 *   npx p5-llm-proxy --https            # Local HTTPS with self-signed cert
 *   npx p5-llm-proxy -t TOKEN -k KEY    # Non-interactive mode
 */

// =============================================================================
// Dependencies
// =============================================================================

const express = require('express');
const cors = require('cors');
const https = require('https');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { Command } = require('commander');
const chalk = require('chalk');
const readline = require('readline');
const selfsigned = require('selfsigned');
const ngrok = require('@ngrok/ngrok');

// =============================================================================
// Configuration
// =============================================================================

/** Google Gemini API base URL */
const TARGET = 'https://generativelanguage.googleapis.com';

// =============================================================================
// CLI Setup
// =============================================================================

const program = new Command();

program
  .name('p5-llm-proxy')
  .description('A local proxy for the Google Gemini API to bypass CORS issues in web editors')
  .option('-k, --key <key>', 'Google Gemini API key')
  .option('-t, --token <token>', 'ngrok auth token')
  .option('-p, --port <number>', 'Port to run the proxy server on', '8000')
  .option('-l, --local', 'Local mode only (no ngrok tunnel)')
  .option('-s, --https', 'Enable HTTPS with self-signed certificate (local mode only)')
  .parse(process.argv);

const options = program.opts();

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Prompts the user for input via stdin
 * @param {string} message - The prompt message to display
 * @returns {Promise<string>} The user's input (trimmed)
 */
function prompt(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Prompts the user for their ngrok auth token with instructions
 * @returns {Promise<string>} The ngrok auth token
 */
async function promptForNgrokToken() {
  console.log(chalk.yellow('\n🌐 ngrok token required for public URL\n'));
  console.log(chalk.gray('To get your free ngrok token:'));
  console.log(chalk.gray('  1. Sign up at https://ngrok.com (free)'));
  console.log(chalk.gray('  2. Go to https://dashboard.ngrok.com/get-started/your-authtoken'));
  console.log(chalk.gray('  3. Copy your authtoken\n'));
  
  return await prompt(chalk.cyan('Enter your ngrok auth token: '));
}

/**
 * Prompts the user for their Gemini API key with instructions
 * @returns {Promise<string>} The Gemini API key
 */
async function promptForApiKey() {
  console.log(chalk.yellow('\n🔑 Gemini API key required\n'));
  console.log(chalk.gray('To get your free Gemini API key:'));
  console.log(chalk.gray('  1. Go to https://aistudio.google.com/apikey'));
  console.log(chalk.gray('  2. Click "Create API Key"'));
  console.log(chalk.gray('  3. Copy the key\n'));
  
  return await prompt(chalk.cyan('Enter your Gemini API key: '));
}

// =============================================================================
// Express App Factory
// =============================================================================

/**
 * Creates and configures the Express application with CORS and proxy middleware
 * @param {string} API_KEY - The Gemini API key for authentication
 * @param {number} PORT - The port number the server runs on
 * @param {string|null} publicUrl - The public ngrok URL (if available)
 * @returns {express.Application} The configured Express app
 */
function createApp(API_KEY, PORT, publicUrl = null) {
  const app = express();

  // ---------------------------------------------------------------------------
  // CORS Configuration
  // ---------------------------------------------------------------------------
  
  // Enable CORS for all origins - required for browser-based editors
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization', 
      'X-Requested-With',
      'Accept',
      'Origin',
      'ngrok-skip-browser-warning'  // Required for ngrok free tier
    ],
    credentials: false
  }));

  // Handle Chrome's Private Network Access (PNA) preflight requests
  // This is required for requests from public HTTPS sites to localhost
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
  });

  // Explicitly handle OPTIONS preflight requests
  app.options('*', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 
      'Content-Type, Authorization, X-Requested-With, Accept, Origin, ngrok-skip-browser-warning');
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.status(204).end();
  });

  // ---------------------------------------------------------------------------
  // Logging Middleware
  // ---------------------------------------------------------------------------

  // Log all incoming requests
  app.use((req, res, next) => {
    console.log(chalk.cyan(`→ ${req.method} ${req.url}`));
    next();
  });

  // ---------------------------------------------------------------------------
  // Routes
  // ---------------------------------------------------------------------------

  // Root route - returns helpful API info
  app.get('/', (req, res) => {
    const baseUrl = publicUrl || `http://localhost:${PORT}`;
    res.json({
      status: 'running',
      message: 'p5-llm-proxy is running',
      publicUrl: publicUrl || 'Not available (local mode)',
      usage: `POST ${baseUrl}/v1beta/models/gemini-2.5-flash:generateContent`,
      example: {
        url: `${baseUrl}/v1beta/models/gemini-2.5-flash:generateContent`,
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: {
          contents: [{ parts: [{ text: 'Hello!' }] }]
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Proxy Middleware
  // ---------------------------------------------------------------------------

  // Proxy all /v1beta/* requests to the Gemini API
  app.use(
    '/v1beta',
    createProxyMiddleware({
      target: TARGET,
      changeOrigin: true,
      
      // Express strips the mount path (/v1beta), so we need to restore it
      pathRewrite: (path) => `/v1beta${path}`,
      
      // Event handlers for the proxy
      on: {
        // Inject API key into outgoing requests
        proxyReq: (proxyReq, req, res) => {
          // Use x-goog-api-key header (official authentication method)
          proxyReq.setHeader('x-goog-api-key', API_KEY);
        },
        
        // Process responses from the Gemini API
        proxyRes: (proxyRes, req, res) => {
          // Ensure CORS headers are present on the response
          proxyRes.headers['Access-Control-Allow-Origin'] = '*';
          proxyRes.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
          proxyRes.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
          
          // Log response with color-coded status
          const statusColor = proxyRes.statusCode >= 400 ? chalk.red : chalk.green;
          console.log(statusColor(`← ${proxyRes.statusCode} ${req.method} ${req.url}`));
        },
        
        // Handle proxy errors
        error: (err, req, res) => {
          console.error(chalk.red(`✖ Proxy error: ${err.message}`));
          if (res.writeHead) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
          }
        }
      }
    })
  );

  return app;
}

// =============================================================================
// Server Startup Functions
// =============================================================================

/**
 * Starts the server in HTTPS mode with a self-signed certificate
 * @param {express.Application} app - The Express application
 * @param {number} PORT - The port to listen on
 */
function startHttpsServer(app, PORT) {
  console.log(chalk.yellow('🔐 Generating self-signed certificate...'));
  
  // Generate self-signed certificate
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = selfsigned.generate(attrs, {
    algorithm: 'sha256',
    days: 365,
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' }
        ]
      }
    ]
  });

  const httpsServer = https.createServer({ key: pems.private, cert: pems.cert }, app);

  httpsServer.listen(PORT, () => {
    console.log(chalk.green(`\n🚀 Proxy running at https://localhost:${PORT}`));
    console.log(chalk.gray(`   Proxying requests to ${TARGET}`));
    console.log(chalk.yellow(`\n⚠️  Note: Self-signed certs don't work with p5.js web editor.`));
    console.log(chalk.yellow(`   Use ngrok mode (without --https) for p5.js web editor.\n`));
  });
}

/**
 * Starts the server with ngrok tunnel for public HTTPS access
 * @param {express.Application} app - The Express application
 * @param {number} PORT - The port to listen on
 * @param {string} ngrokToken - The ngrok auth token
 */
function startNgrokServer(app, PORT, ngrokToken) {
  app.listen(PORT, async () => {
    console.log(chalk.gray(`   Local server on port ${PORT}`));
    console.log(chalk.yellow('🌐 Starting ngrok tunnel...\n'));

    try {
      // Connect to ngrok
      const listener = await ngrok.connect({
        addr: PORT,
        authtoken: ngrokToken
      });

      const publicUrl = listener.url();
      
      // Display success message with public URL
      console.log(chalk.green('═══════════════════════════════════════════════════════════════'));
      console.log(chalk.green.bold('\n🎉 Proxy is ready!\n'));
      console.log(chalk.white.bold('   Public URL (use this in p5.js):'));
      console.log(chalk.cyan.bold(`   ${publicUrl}\n`));
      console.log(chalk.green('═══════════════════════════════════════════════════════════════\n'));
      
      // Display example code
      console.log(chalk.gray('Example p5.js code:\n'));
      console.log(chalk.gray('─────────────────────────────────────────────────────────────────'));
      console.log(chalk.white(`const PROXY_URL = '${publicUrl}';

async function setup() {
  createCanvas(400, 400);
  
  const response = await fetch(\`\${PROXY_URL}/v1beta/models/gemini-2.5-flash:generateContent\`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true'  // Required for ngrok free tier
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Hello!' }] }]
    })
  });
  
  const data = await response.json();
  console.log(data.candidates[0].content.parts[0].text);
}`));
      console.log(chalk.gray('─────────────────────────────────────────────────────────────────\n'));
      console.log(chalk.gray(`Proxying to: ${TARGET}`));
      console.log(chalk.gray('Press Ctrl+C to stop\n'));

    } catch (err) {
      // Fallback to local mode if ngrok fails
      console.error(chalk.red(`\n✖ ngrok error: ${err.message}`));
      console.log(chalk.yellow('\nFalling back to local mode...'));
      console.log(chalk.green(`\n🚀 Proxy running at http://localhost:${PORT}`));
      console.log(chalk.yellow('⚠️  This URL won\'t work with the p5.js web editor.\n'));
    }
  });
}

/**
 * Starts the server in local HTTP mode (no ngrok)
 * @param {express.Application} app - The Express application
 * @param {number} PORT - The port to listen on
 */
function startLocalServer(app, PORT) {
  app.listen(PORT, () => {
    console.log(chalk.green(`\n🚀 Proxy running at http://localhost:${PORT}`));
    console.log(chalk.gray(`   Proxying requests to ${TARGET}`));
    console.log(chalk.yellow('\n⚠️  Local mode: This won\'t work with the p5.js web editor.'));
    console.log(chalk.gray('   Run without --local flag and provide ngrok token for public URL.\n'));
  });
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Main function - handles CLI flow and starts the appropriate server
 */
async function main() {
  // Display banner
  console.log(chalk.bold.blue('\n╔════════════════════════════════════╗'));
  console.log(chalk.bold.blue('║         p5-llm-proxy               ║'));
  console.log(chalk.bold.blue('║   Gemini API Proxy for p5.js       ║'));
  console.log(chalk.bold.blue('╚════════════════════════════════════╝\n'));

  const PORT = parseInt(options.port, 10);
  const isLocalMode = options.local || options.https;

  // -------------------------------------------------------------------------
  // Collect credentials
  // -------------------------------------------------------------------------

  // Get ngrok token (if not in local mode)
  let ngrokToken = options.token;
  if (!isLocalMode && !ngrokToken) {
    ngrokToken = await promptForNgrokToken();
    if (!ngrokToken) {
      console.log(chalk.yellow('\n⚠️  No ngrok token provided. Running in local mode.'));
      console.log(chalk.gray('   Use --local flag to skip this prompt next time.\n'));
    }
  }

  // Get Gemini API key
  let API_KEY = options.key;
  if (!API_KEY) {
    API_KEY = await promptForApiKey();
    if (!API_KEY) {
      console.error(chalk.red('\n✖ Error: Gemini API key is required.'));
      process.exit(1);
    }
  }

  console.log(''); // Add spacing

  // -------------------------------------------------------------------------
  // Create and start server
  // -------------------------------------------------------------------------

  const app = createApp(API_KEY, PORT);

  if (options.https) {
    // HTTPS mode with self-signed certificate
    startHttpsServer(app, PORT);
  } else if (ngrokToken) {
    // ngrok mode for public HTTPS URL
    startNgrokServer(app, PORT, ngrokToken);
  } else {
    // Local HTTP mode
    startLocalServer(app, PORT);
  }
}

// =============================================================================
// Process Event Handlers
// =============================================================================

// Handle graceful shutdown (Ctrl+C)
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n\n👋 Shutting down...\n'));
  await ngrok.disconnect();
  process.exit(0);
});

// =============================================================================
// Run
// =============================================================================

main();
