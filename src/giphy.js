const https = require('https');
const { uploadAudio } = require('./storage');

function moodToQuery(happiness, energy) {
  if (happiness < 30) return 'sad crying';
  if (energy < 30) return 'tired sleepy';
  if (happiness > 75 && energy > 75) return 'happy excited';
  if (happiness > 60) return 'happy cute';
  return 'okay relax';
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Fetch GIF from Giphy, download it to our server, return a hosted URL.
 * Serving from our own server ensures Twilio can always fetch the media.
 */
async function getMoodGif(happiness, energy) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) { console.warn('GIPHY_API_KEY missing'); return null; }

  const query = encodeURIComponent(moodToQuery(happiness, energy));
  const apiUrl = `https://api.giphy.com/v1/gifs/random?api_key=${key}&tag=${query}&rating=g`;

  const apiData = await fetchUrl(apiUrl);
  const json = JSON.parse(apiData.toString());
  const gifUrl = json?.data?.images?.downsized?.url || json?.data?.images?.original?.url;
  if (!gifUrl) { console.warn('No GIF URL from Giphy'); return null; }

  console.log('Downloading GIF:', gifUrl);
  const gifBuffer = await fetchUrl(gifUrl);
  const filename = `gif_${Date.now()}.gif`;
  const hostedUrl = await uploadAudio(gifBuffer, filename);
  console.log('GIF hosted at:', hostedUrl);
  return hostedUrl;
}

module.exports = { getMoodGif };
