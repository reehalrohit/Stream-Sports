const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const UPSTREAM_API_URL = process.env.UPSTREAM_API_URL || 'https://ondemand.st/papi/api/streams';
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 8000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 15000;

let cache = { expiresAt: 0, data: null };

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      frameSrc: ['https:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"]
    }
  }
}));

const corsOrigin = process.env.CORS_ORIGIN?.trim();
if (corsOrigin) {
  app.use(cors({
    origin: corsOrigin.split(',').map((value) => value.trim()).filter(Boolean)
  }));
}

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '1h'
}));

function isValidHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeStreams(data) {
  if (!data || data.success !== true || !Array.isArray(data.streams)) {
    return { success: false, streams: [] };
  }

  const categories = data.streams
    .filter((category) => category && Array.isArray(category.streams))
    .map((category) => ({
      ...category,
      streams: category.streams
        .filter((stream) => stream && stream.status === 'live')
        .map((stream) => ({
          id: String(stream.id ?? ''),
          name: String(stream.name ?? 'Live match'),
          league: String(stream.league ?? 'Sports'),
          viewers: Number.isFinite(Number(stream.viewers)) ? Number(stream.viewers) : 0,
          status: 'live',
          iframe: isValidHttpsUrl(stream.iframe) ? stream.iframe : null
        }))
        .filter((stream) => stream.id && stream.iframe)
    }))
    .filter((category) => category.streams.length > 0);

  return { success: true, streams: categories };
}

async function fetchUpstream() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(UPSTREAM_API_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Stream-Sports/1.1'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Upstream returned ${response.status}`);
    }

    return sanitizeStreams(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'stream-sports' });
});

app.get('/papi/api/streams', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=10, stale-while-revalidate=30');

  if (cache.data && Date.now() < cache.expiresAt) {
    return res.json(cache.data);
  }

  try {
    const data = await fetchUpstream();
    cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
    return res.json(data);
  } catch (error) {
    if (cache.data) {
      return res.json(cache.data);
    }

    console.error('Stream API error:', error.message);
    return res.status(502).json({
      success: false,
      streams: [],
      error: 'Live stream service is temporarily unavailable.'
    });
  }
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
