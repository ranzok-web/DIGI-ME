// Text-to-Speech using Microsoft Edge TTS — completely free, no API key needed.
// Hebrew voice: he-IL-HilaNeural (female, natural)
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const VOICE = process.env.TTS_VOICE || 'he-IL-HilaNeural';

async function textToSpeech(text) {
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
