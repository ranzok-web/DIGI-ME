const fs = require('fs');
const path = require('path');
const os = require('os');

const AUDIO_DIR = path.join(os.tmpdir(), 'digital-soul-audio');
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${process.env.PORT || 3000}`;

// Ensure audio directory exists
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

async function ensureBucket() {
  if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

/**
 * Save audio buffer to temp file and return a public URL (served by our own Express server).
 * File auto-deletes after 10 minutes.
 */
async function uploadAudio(buffer, filename) {
  const filepath = path.join(AUDIO_DIR, filename);
  fs.writeFileSync(filepath, buffer);

  // Auto-delete after 10 minutes
  setTimeout(() => {
    try { fs.unlinkSync(filepath); } catch (_) {}
  }, 10 * 60 * 1000);

  return `${BASE_URL}/audio/${filename}`;
}

function getAudioDir() {
  return AUDIO_DIR;
}

module.exports = { ensureBucket, uploadAudio, getAudioDir };
