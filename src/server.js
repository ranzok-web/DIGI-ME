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
const { ensureBucket, uploadAudio } = require('./storage');
const { textToSpeech } = require('./elevenlabs');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Ensure Supabase audio bucket exists on startup
ensureBucket().catch((e) => console.warn('Audio bucket warning:', e.message));

app.get('/health', (_req, res) => res.json({ ok: true }));

// Detect voice request: user sent "דבר אלי" / "speak" / 🎙️ etc.
const VOICE_TRIGGER = /^(דבר|קול|speak|voice|🎙️?\s*$)/i;

// A. The Reactive Flow — WhatsApp inbound webhook (Twilio)
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const fromNumber = req.body.From;
    const incomingText = (req.body.Body || '').trim();

    if (!fromNumber || !incomingText) {
      return res.status(200).send('ignored');
    }

    const entity = await getOrCreateEntity(fromNumber);

    // Mute command
    if (/^\/?(mute|stop|השתק)$/i.test(incomingText)) {
      await sendWhatsAppMessage(fromNumber, 'הושתקתי בינתיים 🤐 כתוב לי "הקם אותי" כשתרצה שאחזור.');
      return res.status(200).send('muted');
    }

    // Check if voice was requested
    const wantsVoice = VOICE_TRIGGER.test(incomingText);

    await appendHistory(entity.user_id, 'user', incomingText);
    const history = await getRecentHistory(entity.user_id);
    const reply = await getEntityReply(entity, history, incomingText);

    const updatedState = applyAction(entity.entity_state, reply.action, reply.mood_delta);
    await updateEntityState(entity.user_id, updatedState);
    await appendHistory(entity.user_id, 'entity', reply.speech);

    // Always send text reply
    await sendWhatsAppMessage(fromNumber, reply.speech);

    // Respond to Twilio immediately (must be within ~15s)
    res.status(200).send('ok');

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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Digital Soul server listening on port ${port}`));
