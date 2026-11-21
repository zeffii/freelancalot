// Timesheet server: serves the app from ./public and keeps all data in ./timesheet.json.
// No dependencies — run with `node server.js` (or `npm start`) and open http://localhost:3210

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3210;
const HOST = '127.0.0.1'; // local only — not reachable from other machines
const DATA_FILE = path.join(__dirname, 'timesheet.json');
const BACKUP_FILE = `${DATA_FILE}.bak`;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 20 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function readData() {
  if (!fs.existsSync(DATA_FILE)) return { labels: {}, days: {} };
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

// Write to a temp file first and rename it into place, so a crash mid-write
// never leaves a half-written timesheet. The previous version is kept as .bak.
function writeData(data) {
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(data, null, 2));
  if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BACKUP_FILE);
  fs.renameSync(tempFile, DATA_FILE);
}

function isValidData(data) {
  return data && typeof data === 'object'
    && data.labels && typeof data.labels === 'object'
    && data.days && typeof data.days === 'object';
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(body));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleDataRequest(req, res) {
  if (req.method === 'GET') {
    sendJson(res, 200, readData());
    return;
  }
  if (req.method === 'PUT') {
    const data = JSON.parse(await readRequestBody(req));
    if (!isValidData(data)) {
      sendJson(res, 400, { error: 'Expected { labels: {}, days: {} }' });
      return;
    }
    writeData(data);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 405, { error: 'Method not allowed' });
}

function serveStaticFile(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relativePath = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const filePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  const contentType = MIME_TYPES[path.extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/data')) {
      await handleDataRequest(req, res);
    } else {
      serveStaticFile(req, res);
    }
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Timesheet running at http://localhost:${PORT}`);
  console.log(`Data file: ${DATA_FILE}`);
});
