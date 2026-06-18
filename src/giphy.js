const https = require('https');

function moodToQuery(happiness, energy) {
  if (happiness < 30) return 'sad crying';
  if (energy < 30) return 'tired sleepy';
  if (happiness > 75 && energy > 75) return 'happy excited';
  if (happiness > 60) return 'happy cute';
  return 'okay relax';
}

/**
 * Fetch a random GIF URL from Giphy matching the entity's current mood.
 */
async function getMoodGif(happiness, energy) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) { console.warn('GIPHY_API_KEY missing'); return null; }

  const query = encodeURIComponent(moodToQuery(happiness, energy));
  const url = `https://api.giphy.com/v1/gifs/random?api_key=${key}&tag=${query}&rating=g`;
  console.log('Giphy request:', url);

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('Giphy status:', res.statusCode, 'data type:', typeof json.data);
          // Use downsized URL — more reliable for Twilio delivery
          const gifUrl = json?.data?.images?.downsized?.url
            || json?.data?.images?.original?.url
            || null;
          console.log('GIF URL:', gifUrl);
          resolve(gifUrl);
        } catch (e) {
          console.error('Giphy parse error:', e.message);
          resolve(null);
        }
      });
      res.on('error', (e) => { console.error('Giphy request error:', e.message); resolve(null); });
    }).on('error', (e) => { console.error('Giphy connect error:', e.message); resolve(null); });
  });
}

module.exports = { getMoodGif };
