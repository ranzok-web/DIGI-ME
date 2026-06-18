const OpenAI = require('openai');
const https = require('https');
const http = require('http');

// Lazy init — don't crash on startup if key is missing
let openai;
function getClient() {
  if (!openai) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openai;
}

/**
 * Download audio from Twilio URL using Basic Auth headers and transcribe with Whisper.
 */
async function transcribeAudio(mediaUrl) {
  const buffer = await downloadWithBasicAuth(mediaUrl,
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  const { toFile } = require('openai');
  const file = await toFile(buffer, 'audio.ogg', { type: 'audio/ogg' });

  const transcription = await getClient().audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'he',
  });

  return transcription.text || null;
}

function downloadWithBasicAuth(url, username, password, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));

    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
    };

    lib.get(options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadWithBasicAuth(res.headers.location, username, password, redirectCount + 1)
          .then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = { transcribeAudio };
