const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

// Serve static frontend files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Ping Endpoint
app.get('/papi/api/ping', (req, res) => {
  res.json({
    success: true,
    timestamp: Math.floor(Date.now() / 1000)
  });
});

// Streams Endpoint
app.get('/papi/api/streams', (req, res) => {
  res.json({
    "success": true,
    "timestamp": Math.floor(Date.now() / 1000),
    "READ_ME": "Free public API by DAMITV.",
    "performance": 0.12,
    "streams": [
      {
        "category": "football",
        "id": 1,
        "streams": [
          {
            "id": "wc/2026-06-16/fra-sen",
            "name": "France vs. Senegal",
            "poster": "https://api.ppv.to/assets/thumb/...",
            "starts_at": 1781625600,
            "ends_at": 1781652600,
            "category_name": "football",
            "status": "live",
            "league": "FIFA World Cup 2026",
            "teams": {
              "home": { "name": "France", "badge": "" },
              "away": { "name": "Senegal", "badge": "" }
            },
            "viewers": 1250,
            "sources": [
              { "source": "hls", "id": "s1", "name": "Server 1", "embed": "https://damitv.st/embed/?id=wc/2026-06-16/fra-sen" },
              { "source": "hls", "id": "s2", "name": "BBC One", "embed": "https://damitv.st/embed/?id=wc/2026-06-16/fra-sen/uk" }
            ],
            "iframe": "https://damitv.st/embed/?id=wc/2026-06-16/fra-sen",
            "embed": "https://damitv.st/embed/?id=wc/2026-06-16/fra-sen"
          }
        ]
      }
    ]
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
