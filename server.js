const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/papi/api/streams', async (req, res) => {
  try {
    // 1. Fetch from the master API 
    const response = await fetch('https://ondemand.st/papi/api/streams', {
      headers: {
        'User-Agent': 'Vercel-Stream-Proxy/1.0',
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) throw new Error('API fetch failed');
    let data = await response.json();
    
    // 2. FILTERING: Do not send all content to the frontend.
    // We map through the categories and strictly keep "live" streams.
    if (data.success && data.streams) {
      data.streams = data.streams.map(category => {
        category.streams = category.streams.filter(stream => stream.status === 'live');
        return category;
      }).filter(category => category.streams.length > 0); // Remove empty categories
    }

    res.json(data);
  } catch (error) {
    console.error("Fetch error:", error);
    res.status(500).json({ success: false, error: 'Failed to fetch active streams' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
