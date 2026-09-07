const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();

const PORT = Number(process.env.PORT) || 3000;

const UPSTREAM_API_URL =
  process.env.UPSTREAM_API_URL ||
  'https://ondemand.st/papi/api/streams';

const FETCH_TIMEOUT_MS =
  Number(process.env.FETCH_TIMEOUT_MS) || 10000;

const CACHE_TTL_MS =
  Number(process.env.CACHE_TTL_MS) || 60000;

let cache = {
  data: null,
  expiresAt: 0
};

app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        frameSrc: ["https:"],
        imgSrc: ["'self'", "data:", "https:"],
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
        .map((item) => item.trim())
        .filter(Boolean)
    })
  );
}

app.use(
  express.json({
    limit: '50kb'
  })
);

app.use(
  express.static(
    path.join(__dirname, 'public'),
    {
      etag: true,
      maxAge: '1h'
    }
  )
);

function getHttpsUrl(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol !== 'https:') {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function getStreamEmbedUrl(stream) {
  // 1. Primary API iframe field
  const iframeUrl = getHttpsUrl(stream.iframe);

  if (iframeUrl) {
    return iframeUrl;
  }

  // 2. Fallback API embed field
  const embedUrl = getHttpsUrl(stream.embed);

  if (embedUrl) {
    return embedUrl;
  }

  // 3. Fallback to first available source
  if (Array.isArray(stream.sources)) {
    for (const source of stream.sources) {
      if (!source || typeof source !== 'object') {
        continue;
      }

      const sourceUrl = getHttpsUrl(source.embed);

      if (sourceUrl) {
        return sourceUrl;
      }
    }
  }

  return null;
}

function isLiveStatus(status) {
  const value = String(status ?? '')
    .trim()
    .toLowerCase();

  return [
    'live',
    'on',
    'online',
    'streaming',
    'started',
    '1',
    'true'
  ].includes(value);
}

function sanitizeStream(stream) {
  if (!stream || typeof stream !== 'object') {
    return null;
  }

  const id = String(stream.id ?? '').trim();

  if (!id || !isLiveStatus(stream.status)) {
    return null;
  }

  const embedUrl = getStreamEmbedUrl(stream);

  const sources = Array.isArray(stream.sources)
    ? stream.sources
        .map((source) => {
          if (!source || typeof source !== 'object') {
            return null;
          }

          const url = getHttpsUrl(source.embed);

          if (!url) {
            return null;
          }

          return {
            name: String(
              source.name ??
              source.source ??
              'Stream'
            ),
            url
          };
        })
        .filter(Boolean)
    : [];

  return {
    id,
    name: String(
      stream.name ??
      'Live Match'
    ),
    league: String(
      stream.league ??
      stream.category_name ??
      'Sports'
    ),
    viewers: Number.isFinite(
      Number(stream.viewers)
    )
      ? Number(stream.viewers)
      : 0,
    poster: getHttpsUrl(stream.poster),
    status: 'live',
    iframe: embedUrl,
    sources
  };
}

function sanitizeData(data) {
  if (!data || typeof data !== 'object') {
    return {
      success: false,
      streams: []
    };
  }

  const categories = Array.isArray(data.streams)
    ? data.streams
    : [];

  const result = categories
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
        category: String(
          category.category ??
          category.category_name ??
          'Sports'
        ),
        id: category.id ?? null,
        streams
      };
    })
    .filter(
      (category) =>
        category.streams.length > 0
    );

  return {
    success: true,
    streams: result
  };
}

async function fetchUpstream() {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(
      UPSTREAM_API_URL,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        `Upstream HTTP ${response.status}`
      );
    }

    const contentType =
      response.headers.get('content-type') || '';

    if (
      !contentType
        .toLowerCase()
        .includes('application/json')
    ) {
      throw new Error(
        'Upstream response was not JSON'
      );
    }

    const json = await response.json();

    return sanitizeData(json);
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

app.get(
  '/papi/api/streams',
  async (_req, res) => {
    res.set(
      'Cache-Control',
      'public, max-age=30, stale-while-revalidate=60'
    );

    if (
      cache.data &&
      Date.now() < cache.expiresAt
    ) {
      return res.json(cache.data);
    }

    try {
      const data =
        await fetchUpstream();

      cache = {
        data,
        expiresAt:
          Date.now() + CACHE_TTL_MS
      };

      return res.json(data);
    } catch (error) {
      console.error(
        'Stream API error:',
        error.message
      );

      if (cache.data) {
        return res.json({
          ...cache.data,
          stale: true
        });
      }

      return res.status(502).json({
        success: false,
        streams: [],
        error:
          'Live stream service is temporarily unavailable.'
      });
    }
  }
);

app.use(
  (err, _req, res, _next) => {
    console.error(
      'Unhandled server error:',
      err
    );

    res.status(500).json({
      success: false,
      streams: [],
      error:
        'Internal server error.'
    });
  }
);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(
      `Stream-Sports listening on port ${PORT}`
    );
  });
}

module.exports = app;
