require('dotenv').config();
const express = require('express');
const {
  getOrCreateEntity,
  updateEntityState,
  appendHistory,
  getRecentHistory,
} = require('./supabase');
const { getEntityReply } = require('./claude');
const { applyAction } = require('./actions');
const { sendWhatsAppMessage, sendWhatsAppAudio } = require('./twilio');
const { runDecayJob } = require('./decay');
const cron = require('node-cron');
const { ensureBucket, uploadAudio, getAudioDir } = require('./storage');
const { textToSpeech } = require('./elevenlabs');
const { transcribeAudio } = require('./whisper');
const { getMoodGif } = require('./giphy');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Ensure Supabase audio bucket exists on startup
ensureBucket().catch((e) => console.warn('Audio bucket warning:', e.message));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Serve temporary audio files
const path = require('path');
app.use('/audio', require('express').static(getAudioDir()));

// Detect voice request — any of these words/phrases trigger audio reply
const VOICE_TRIGGER = /דבר|קול|הקלטה|שמע|תקליט|הודעה קולית|שלח הודעה|speak|voice|audio|🎙/i;

// A. The Reactive Flow — WhatsApp inbound webhook (Twilio)
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const fromNumber = req.body.From;
    let incomingText = (req.body.Body || '').trim();

    if (!fromNumber) return res.status(200).send('ignored');

    // Incoming voice message from user — transcribe with Whisper
    const mediaUrl = req.body.MediaUrl0;
    const mediaType = (req.body.MediaContentType0 || '');
    if (!incomingText && mediaUrl && mediaType.startsWith('audio')) {
      try {
        const transcribed = await transcribeAudio(mediaUrl);
        if (transcribed) {
          incomingText = transcribed;
        } else {
          await sendWhatsAppMessage(fromNumber, 'לא הצלחתי להבין את ההקלטה, נסה שוב 🎙️');
          return res.status(200).send('transcribe-failed');
        }
      } catch (e) {
        console.error('Whisper error:', e.message);
        await sendWhatsAppMessage(fromNumber, 'שגיאה בתמלול ההקלטה 😕 כתוב לי טקסט בינתיים');
        return res.status(200).send('transcribe-error');
      }
    }

    if (!incomingText) return res.status(200).send('ignored');

    const entity = await getOrCreateEntity(fromNumber);

    // Mute command
    if (/^\/?(mute|stop|השתק)$/i.test(incomingText)) {
      await sendWhatsAppMessage(fromNumber, 'הושתקתי בינתיים 🤐 כתוב לי "הקם אותי" כשתרצה שאחזור.');
      return res.status(200).send('muted');
    }

    // Status command — show current entity stats
    if (/^\/?(סטטוס|מצב|status|stats)$/i.test(incomingText)) {
      const s = entity.entity_state;
      const bar = (v) => '█'.repeat(Math.round(v / 10)) + '░'.repeat(10 - Math.round(v / 10));
      const msg =
        `📊 *מצב הנשמה שלך*\n\n` +
        `😊 אושר:  ${bar(s.happiness)} ${s.happiness}/100\n` +
        `⚡ אנרגיה: ${bar(s.energy)} ${s.energy}/100\n` +
        `💛 קשר:   ${bar(s.bond)} ${s.bond}/100`;
      await sendWhatsAppMessage(fromNumber, msg);
      return res.status(200).send('status');
    }

    // Check if voice or GIF was requested
    const wantsVoice = VOICE_TRIGGER.test(incomingText);
    const wantsGif = /gif|תמונה|תמונת|איך אתה נראה|הראה לי/i.test(incomingText);

    await appendHistory(entity.user_id, 'user', incomingText);
    const history = await getRecentHistory(entity.user_id);
    const reply = await getEntityReply(entity, history, incomingText);

    const updatedState = applyAction(entity.entity_state, reply.action, reply.mood_delta);
    await updateEntityState(entity.user_id, updatedState);
    await appendHistory(entity.user_id, 'entity', reply.speech);

    // If voice requested, send a brief placeholder; otherwise send full text
    if (wantsVoice) {
      await sendWhatsAppMessage(fromNumber, '🎙️ שניה...');
    } else {
      await sendWhatsAppMessage(fromNumber, reply.speech);
    }

    // Respond to Twilio immediately (must be within ~15s)
    res.status(200).send('ok');

    // Send GIF asynchronously if requested
    if (wantsGif) {
      setImmediate(async () => {
        try {
          const gifUrl = await getMoodGif(updatedState.happiness, updatedState.energy);
          if (gifUrl) await sendWhatsAppAudio(fromNumber, gifUrl); // reuse media sender
        } catch (e) {
          console.error('GIF error:', e.message);
        }
      });
    }

    // Additionally send voice asynchronously (after response sent)
    if (wantsVoice) {
      setImmediate(async () => {
        try {
          const mp3Buffer = await textToSpeech(reply.speech);
          const filename = `voice_${entity.user_id}_${Date.now()}.mp3`;
          const audioUrl = await uploadAudio(mp3Buffer, filename);
          await sendWhatsAppAudio(fromNumber, audioUrl);
        } catch (voiceErr) {
          console.error('Voice generation error:', voiceErr.message);
        }
      });
    }
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('error');
  }
});

// Manual trigger for the proactive decay job
app.post('/jobs/decay', async (_req, res) => {
  try {
    const result = await runDecayJob();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Decay job error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Run decay job every 4 hours automatically
cron.schedule('0 */4 * * *', async () => {
  try {
    const result = await runDecayJob();
    console.log('Decay job ran:', result);
  } catch (e) {
    console.error('Decay cron error:', e.message);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Digital Soul server listening on port ${port}`));
