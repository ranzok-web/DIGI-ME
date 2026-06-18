const https = require('https');

const GIPHY_KEY = process.env.GIPHY_API_KEY;

// Map entity mood to search terms
function moodToQuery(happiness, energy) {
  if (happiness < 30) return 'sad crying lonely';
  if (energy < 30) return 'tired sleepy exhausted';
  if (happiness > 75 && energy > 75) return 'happy excited jumping';
  if (happiness > 60) return 'happy smile cute';
  return 'okay fine whatever';
}

/**
 * Fetch a random GIF URL from Giphy matching the entity's current mood.
 */
async function getMoodGif(happiness, energy) {
  if (!GIPHY_KEY) return null;

  const query = encodeURIComponent(moodToQuery(happiness, energy));
  const url = `https://api.giphy.com/v1/gifs/random?api_key=${GIPHY_KEY}&tag=${query}&rating=g`;

  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json?.data?.images?.original?.url || null);
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

module.exports = { getMoodGif };
