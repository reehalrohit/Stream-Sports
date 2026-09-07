const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();

const PORT = Number(process.env.PORT) || 3000;
const UPSTREAM_API_URL =
  process.env.UPSTREAM_API_URL || 'https://ondemand.st/papi/api/streams';

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 15000;

let cache = {
  expiresAt: 0,
  data: null
};

app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameSrc: ['https:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"]
      }
    }
  })
);

const corsOrigin = process.env.CORS_ORIGIN?.trim();

if (corsOrigin) {
  app.use(
    cors({
      origin: corsOrigin
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    })
  );
} else {
  app.use(cors({ origin: false }));
}

app.use(express.json({ limit: '50kb' }));

app.use(
  express.static(path.join(__dirname, 'public'), {
    etag: true,
    maxAge: '1h'
  })
);

function isValidUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }

  try {
    const url = new URL(value);

    return (
      url.protocol === 'https:' &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

function normalizeStatus(status) {
  return String(status || '').trim().toLowerCase();
}

function sanitizeStream(stream) {
  if (!stream || typeof stream !== 'object') {
    return null;
  }

  const id = String(stream.id ?? '').trim();

  if (!id) {
    return null;
  }

  const iframe =
    typeof stream.iframe === 'string' ? stream.iframe.trim() : '';

  const normalizedStatus = normalizeStatus(stream.status);

  // Accept common live-status values.
  const isLive = [
    'live',
    'on',
    'online',
    'streaming',
    'started',
    '1',
    'true'
  ].includes(normalizedStatus);

  if (!isLive) {
    return null;
  }

  return {
    id,
    name: String(stream.name ?? 'Live Match'),
    league: String(stream.league ?? 'Sports'),
    viewers: Number.isFinite(Number(stream.viewers))
      ? Number(stream.viewers)
      : 0,
    status: 'live',
    iframe: isValidUrl(iframe) ? iframe : null
  };
}

function sanitizeStreams(data) {
  if (!data || typeof data !== 'object') {
    return {
      success: false,
      streams: []
    };
  }

  const sourceCategories = Array.isArray(data.streams)
    ? data.streams
    : [];

  const categories = sourceCategories
    .filter(
      (category) =>
        category &&
        typeof category === 'object' &&
        Array.isArray(category.streams)
    )
    .map((category) => {
      const streams = category.streams
        .map(sanitizeStream)
        .filter(Boolean);

      return {
        ...category,
        streams
      };
    })
    .filter((category) => category.streams.length > 0);

  return {
    success: true,
    streams: categories
  };
}

async function fetchUpstream() {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(UPSTREAM_API_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Stream-Sports/1.2'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Upstream returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      throw new Error('Upstream did not return JSON');
    }

    const json = await response.json();

    return sanitizeStreams(json);
  } finally {
    clearTimeout(timeout);
  }
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'stream-sports',
    timestamp: new Date().toISOString()
  });
});

app.get('/papi/api/streams', async (_req, res) => {
  res.set(
    'Cache-Control',
    'public, max-age=10, stale-while-revalidate=30'
  );

  if (cache.data && Date.now() < cache.expiresAt) {
    return res.json(cache.data);
  }

  try {
    const data = await fetchUpstream();

    cache = {
      data,
      expiresAt: Date.now() + CACHE_TTL_MS
    };

    return res.json(data);
  } catch (error) {
    console.error('Stream API error:', error);

    // Serve the last successful response when available.
    if (cache.data) {
      return res.json({
        ...cache.data,
        stale: true
      });
    }

    return res.status(502).json({
      success: false,
      streams: [],
      error: 'Live stream service is temporarily unavailable.'
    });
  }
});

app.use((req, res, next) => {
  if (req.path.startsWith('/papi/')) {
    return next();
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled server error:', err);

  res.status(500).json({
    success: false,
    error: 'Internal server error.'
  });
});

app.listen(PORT, () => {
  console.log(`Stream-Sports server listening on port ${PORT}`);
});
