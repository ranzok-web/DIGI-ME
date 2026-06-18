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
const { PERSONALITIES, getPersonality, listPersonalities } = require('./personalities');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Ensure Supabase audio bucket exists on startup
ensureBucket().catch((e) => console.warn('Audio bucket warning:', e.message));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/test/gif', async (_req, res) => {
  try {
    const url = await getMoodGif(80, 80);
    res.json({ ok: !!url, url, giphy_key_set: !!process.env.GIPHY_API_KEY });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

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
    // Incoming image/GIF from user — treat as a fun reaction
    if (!incomingText && mediaUrl && (mediaType.startsWith('image') || mediaType.startsWith('video'))) {
      incomingText = 'המשתמש שלח לי תמונה/GIF — תגיב בהתאם לאישיות שלך, בצורה מפתיעה ומצחיקה';
    }

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

    // Skin/personality list command
    if (/^\/?(סקין|אישיות|skin|personality|שנה אישיות|בחר אישיות)$/i.test(incomingText)) {
      const current = entity.preferences?.voice_vibe || 'arsit';
      const p = PERSONALITIES[current] || { emoji: '✨', name: 'מותאם אישית' };
      const msg = `🎭 *בחר סקין לדמות*\n\nנוכחי: ${p.emoji} ${p.name}\n\n${listPersonalities()}`;
      await sendWhatsAppMessage(fromNumber, msg);
      return res.status(200).send('skin-list');
    }

    // Custom skin — start flow
    if (incomingText.toLowerCase().trim() === 'custom') {
      await require('./supabase').updatePreferences(entity.user_id, { voice_vibe: 'custom', awaiting_custom_desc: true });
      await sendWhatsAppMessage(fromNumber, '✏️ *סקין מותאם אישית*\n\nתאר לי את הדמות שאתה רוצה — אישיות, סגנון דיבור, מאפיינים מיוחדים.\n\nלמשל: "רובוט ממאדים שמדבר בגוף שלישי ואוהב מתמטיקה"');
      return res.status(200).send('custom-start');
    }

    // Custom skin — receive description
    if (entity.preferences?.awaiting_custom_desc) {
      await require('./supabase').updatePreferences(entity.user_id, {
        voice_vibe: 'custom',
        custom_description: incomingText,
        awaiting_custom_desc: false,
      });
      await sendWhatsAppMessage(fromNumber, `✨ *סקין נשמר!*\n\nהדמות שלך: "${incomingText}"\n\nמעכשיו הדמות תדבר בסגנון הזה!`);
      return res.status(200).send('custom-saved');
    }

    // Switch to preset skin
    const personalityKeys = Object.keys(PERSONALITIES);
    if (personalityKeys.includes(incomingText.toLowerCase().trim())) {
      const key = incomingText.toLowerCase().trim();
      const p = PERSONALITIES[key];
      await require('./supabase').updatePreferences(entity.user_id, { voice_vibe: key, awaiting_custom_desc: false });
      await sendWhatsAppMessage(fromNumber, `${p.emoji} הסקין שונה ל*${p.name}*!`);
      return res.status(200).send('skin-changed');
    }

    // Check if voice or GIF was requested
    const wantsVoice = VOICE_TRIGGER.test(incomingText);
    const wantsGif = /gif|גיף|תמונה|תמונת|איך אתה נראה|הראה לי/i.test(incomingText);

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
          if (gifUrl) {
            console.log('Sending GIF:', gifUrl);
            await sendWhatsAppAudio(fromNumber, gifUrl);
            console.log('GIF sent successfully');
          } else {
            console.warn('No GIF URL returned from Giphy');
            await sendWhatsAppMessage(fromNumber, 'לא מצאתי GIF הפעם 😕');
          }
        } catch (e) {
          console.error('GIF error:', e.message, e.stack);
          await sendWhatsAppMessage(fromNumber, `שגיאה בשליחת GIF: ${e.message}`);
        }
      });
    }

    // Additionally send voice asynchronously (after response sent)
    if (wantsVoice) {
      setImmediate(async () => {
        try {
          const skinVoice = getPersonality(entity.preferences?.voice_vibe, entity.preferences?.custom_description)?.voice;
          const mp3Buffer = await textToSpeech(reply.speech, skinVoice);
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
