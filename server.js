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
    const response = await fetch('https://ondemand.st/papi/api/streams', {
      headers: { 'User-Agent': 'Vercel-Stream-Proxy/1.0', 'Accept': 'application/json' }
    });
    
    if (!response.ok) throw new Error('API fetch failed');
    let data = await response.json();
    
    if (data.success && data.streams) {
      data.streams = data.streams.map(category => {
        // 1. Filter out upcoming matches
        category.streams = category.streams.filter(stream => stream.status === 'live');
        
        // 2. Bypass ISP block by swapping the domain to their unblocked mirror
        category.streams.forEach(stream => {
            if (stream.iframe) {
                stream.iframe = stream.iframe.replace('damitv.st', 'fmdtv.com');
            }
        });

        return category;
      }).filter(category => category.streams.length > 0); 
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch active streams' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
