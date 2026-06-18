// Text-to-Speech using Microsoft Edge TTS — completely free, no API key needed.
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

// קול עברי גברי טבעי — Avri. לא ניתן לשינוי דרך env כדי למנוע שגיאות הגדרה.
const VOICE = 'he-IL-AvriNeural';

/**
 * מסיר אימוג'ים וסמלים שלא צריך לקרוא בקול.
 * משתמש ב-Unicode property escape \p{Extended_Pictographic} שמכסה את כל האימוג'ים.
 */
function stripEmojis(text) {
  return text
    .replace(/\p{Extended_Pictographic}/gu, '')  // כל האימוג'ים
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')        // variation selectors
    .replace(/[\u{200B}-\u{200F}]/gu, '')         // invisible chars
    .replace(/\s{2,}/g, ' ')                      // רווחים כפולים
    .trim();
}

async function textToSpeech(text) {
  text = stripEmojis(text);
  if (!text) return Buffer.alloc(0);

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
