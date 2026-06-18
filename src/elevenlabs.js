// Text-to-Speech using Microsoft Edge TTS — completely free, no API key needed.
// Hebrew voice: he-IL-HilaNeural (female, natural)
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const VOICE = process.env.TTS_VOICE || 'he-IL-AvriNeural'; // Avri = גבר, טבעי יותר. אפשר גם he-IL-HilaNeural לאישה

/**
 * Remove emojis and special characters that shouldn't be read aloud.
 */
function stripEmojis(text) {
  return text
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')   // emoji blocks
    .replace(/[\u{2600}-\u{27BF}]/gu, '')       // misc symbols
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')       // variation selectors
    .replace(/\s{2,}/g, ' ')                    // collapse extra spaces
    .trim();
}

async function textToSpeech(text) {
  text = stripEmojis(text);
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  return new Promise((resolve, reject) => {
    const { audioStream } = tts.toStream(text);
    const chunks = [];
    audioStream.on('data', (chunk) => chunks.push(chunk));
    audioStream.on('end', () => resolve(Buffer.concat(chunks)));
    audioStream.on('error', reject);
  });
}

module.exports = { textToSpeech };
