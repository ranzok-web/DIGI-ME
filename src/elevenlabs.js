// Text-to-Speech using Microsoft Edge TTS — completely free, no API key needed.
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const DEFAULT_VOICE = 'he-IL-HilaNeural';

function stripEmojis(text) {
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
    .replace(/[\u{200B}-\u{200F}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function textToSpeech(text, voice) {
  text = stripEmojis(text);
  if (!text) return Buffer.alloc(0);

  const selectedVoice = voice || DEFAULT_VOICE;
  const tts = new MsEdgeTTS();
  await tts.setMetadata(selectedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  return new Promise((resolve, reject) => {
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
}

module.exports = { textToSpeech };
