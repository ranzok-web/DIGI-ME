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
 * Download audio from Twilio URL (requires Basic Auth) and transcribe with Whisper.
 * Returns transcribed text, or null if failed.
 */
async function transcribeAudio(mediaUrl) {
  // Download the audio file from Twilio
  const buffer = await downloadWithAuth(mediaUrl, {
    username: process.env.TWILIO_ACCOUNT_SID,
    password: process.env.TWILIO_AUTH_TOKEN,
  });

  // Convert buffer to a File object for OpenAI
  const { toFile } = require('openai');
  const file = await toFile(buffer, 'audio.ogg', { type: 'audio/ogg' });

  const transcription = await getClient().audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'he', // עברית
  });

  return transcription.text || null;
}

function downloadWithAuth(url, { username, password }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    parsed.username = username;
    parsed.password = password;

    const lib = parsed.protocol === 'https:' ? https : http;
    lib.get(parsed.toString(), (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        return downloadWithAuth(res.headers.location, { username, password })
          .then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

module.exports = { transcribeAudio };
