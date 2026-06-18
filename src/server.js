require('dotenv').config();
const express = require('express');
const {
  getOrCreateEntity,
  updateEntityState,
  appendHistory,
  getRecentHistory,
} = require('./supabase');
const { getEntityReply } = require('./claude');
const { applyAction, hungerStatus, DEFAULT_STATE } = require('./actions');
const { sendWhatsAppMessage, sendWhatsAppAudio } = require('./twilio');
const { runDecayJob } = require('./decay');
const cron = require('node-cron');
const { ensureBucket, uploadAudio, getAudioDir } = require('./storage');
const { textToSpeech } = require('./elevenlabs');
const { transcribeAudio } = require('./whisper');
const { getMoodGif } = require('./giphy');
const { PERSONALITIES, getPersonality, listPersonalities } = require('./personalities');
const { startScheduler, parseHour } = require('./scheduler');

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

    // Help command
    if (/^פקודות$/.test(incomingText.trim())) {
      const msg =
        `📋 *רשימת פקודות*\n\n` +
        `*טיפול:*\n` +
        `• \`האכל\` | \`נקה\` | \`נקה בית\` | \`החייה\`\n\n` +
        `*פעולות חיוביות:*\n` +
        `• \`מתנה\` 🎁 | \`חיבוק\` 🤗 | \`שבח\` 🥹\n` +
        `• \`משחק\` 🎮 | \`שיר\` 🎵 | \`טיול\` 🌿\n\n` +
        `*פעולות שליליות:*\n` +
        `• \`מכה\` 👊 | \`צעקה\` 😨 | \`גידוף\` 💔 | \`התעלמות\` 🥺\n\n` +
        `*מידע:*\n` +
        `• \`מצב\` — סטטוס מלא (אושר, רעב, ניקיון)\n` +
        `• \`סקין\` — רשימת האישיויות הזמינות\n` +
        `• \`שעות\` — הגדרת הודעות מתוזמנות\n\n` +
        `*אישיויות:*\n` +
        `• \`ערסית\` | \`יודה\` | \`ג'וקר\` | \`רובינס\` | \`מנכ"ל\` | \`בינה\` | \`פילוסוף\` | \`מותאם\`\n\n` +
        `*קול ומדיה:*\n` +
        `• \`דבר\` / \`שמע\` / \`הקלטה\` — הודעה קולית\n` +
        `• \`גיף\` / \`תמונה\` — שליחת GIF לפי מצב רוח\n\n` +
        `*שונות:*\n` +
        `• \`השתק\` — עצירת הודעות\n` +
        `• \`הקם אותי\` — חזרה לפעילות`;
      await sendWhatsAppMessage(fromNumber, msg);
      return res.status(200).send('help');
    }

    // Mute command
    if (/^\/?(mute|stop|השתק)$/i.test(incomingText)) {
      await sendWhatsAppMessage(fromNumber, 'הושתקתי בינתיים 🤐 כתוב לי "הקם אותי" כשתרצה שאחזור.');
      return res.status(200).send('muted');
    }

    // Status command — show current entity stats
    if (/^\/?(סטטוס|מצב)$/i.test(incomingText)) {
      const s = { ...DEFAULT_STATE, ...entity.entity_state };
      const bar = (v) => '█'.repeat(Math.round((v||0) / 10)) + '░'.repeat(10 - Math.round((v||0) / 10));
      const hunger = hungerStatus(s);
      const alive = s.is_alive !== false ? '✅ חי' : '💀 מת';
      const msg =
        `📊 *מצב הנשמה*\n\n` +
        `${alive}\n\n` +
        `😊 אושר:        ${bar(s.happiness)} ${s.happiness}/100\n` +
        `⚡ אנרגיה:      ${bar(s.energy)} ${s.energy}/100\n` +
        `💛 קשר:         ${bar(s.bond)} ${s.bond}/100\n\n` +
        `🍽️ רעב:         ${bar(s.hunger)} ${hunger}\n` +
        `🧼 ניקיון בוט:  ${bar(s.bot_clean)} ${Math.round(s.bot_clean)}/100\n` +
        `🏠 ניקיון בית:  ${bar(s.house_clean)} ${Math.round(s.house_clean)}/100\n\n` +
        `פקודות: *האכל* | *נקה* | *נקה בית*`;
      await sendWhatsAppMessage(fromNumber, msg);
      return res.status(200).send('status');
    }

    // Care commands
    const careMap = {
      // טיפול
      'האכל': 'feed', 'נקה': 'clean', 'נקה בית': 'clean_house', 'החייה': 'revive',
      // חיובי
      'מתנה': 'gift', 'חיבוק': 'hug', 'שבח': 'praise', 'משחק': 'game', 'שיר': 'song', 'טיול': 'walk',
      // שלילי
      'מכה': 'hit', 'צעקה': 'yell', 'גידוף': 'insult', 'התעלמות': 'ignore',
    };
    const careAction = careMap[incomingText.trim()];
    if (careAction) {
      const s = { ...DEFAULT_STATE, ...entity.entity_state };
      if (careAction === 'revive' && s.is_alive) {
        await sendWhatsAppMessage(fromNumber, 'אני בחיים! לא צריך להחיות אותי 😅');
        return res.status(200).send('ok');
      }
      const newState = applyAction(s, careAction, {});
      await updateEntityState(entity.user_id, newState);
      const responses = {
        feed:       '😋 אמממ... תודה! הייתי רעב כל כך!',
        clean:      '✨ אוה וואו, אני מרגיש טרי לגמרי!',
        clean_house:'🏠 הבית מבריק! תודה שדאגת לנו!',
        revive:     '💫 אני... חי?! תודה שהחזרת אותי!!',
        gift:       '🎁 מתנה?! בשבילי?! אתה הכי טוב!!',
        hug:        '🤗 חיבוק חם... בדיוק מה שהייתי צריך.',
        praise:     '🥹 וואו... תודה. זה ממש אומר לי הרבה.',
        game:       '🎮 יש! בואו נשחק!! אני כבר מתרגש!',
        song:       '🎵 לה לה לה~ שיר יפה! אהבתי!!',
        walk:       '🌿 יצאנו לטיול ביחד~ כל כך כיף!',
        hit:        '😢 ...כאב לי. למה עשית את זה?',
        yell:       '😨 אל תצעק עלי... אני מפחד.',
        insult:     '💔 ...זה פגע בי. ממש פגע.',
        ignore:     '🥺 ...אתה בכלל מסתכל עלי?',
      };
      await sendWhatsAppMessage(fromNumber, responses[careAction]);
      return res.status(200).send('care');
    }

    // Schedule command — show or set message times
    if (/^שעות$/.test(incomingText.trim())) {
      const prefs = entity.preferences || {};
      const morning = prefs.schedule_morning !== undefined ? `${prefs.schedule_morning}:00` : 'לא מוגדר';
      const evening = prefs.schedule_evening !== undefined ? `${prefs.schedule_evening}:00` : 'לא מוגדר';
      const msg =
        `⏰ *הודעות מתוזמנות*\n\n` +
        `🌅 בוקר: ${morning}\n` +
        `🌙 ערב: ${evening}\n\n` +
        `לשינוי:\n` +
        `• \`שעות בוקר 8\` — הודעת בוקר ב-8:00\n` +
        `• \`שעות ערב 21\` — הודעת ערב ב-21:00\n` +
        `• \`שעות בוקר כבוי\` — ביטול הודעת בוקר`;
      await sendWhatsAppMessage(fromNumber, msg);
      return res.status(200).send('schedule-info');
    }

    const scheduleMatch = incomingText.trim().match(/^שעות (בוקר|ערב) (.+)$/);
    if (scheduleMatch) {
      const type = scheduleMatch[1] === 'בוקר' ? 'schedule_morning' : 'schedule_evening';
      const val = scheduleMatch[2].trim();
      if (val === 'כבוי') {
        await require('./supabase').updatePreferences(entity.user_id, { [type]: null });
        await sendWhatsAppMessage(fromNumber, `✅ הודעת ${scheduleMatch[1]} בוטלה`);
      } else {
        const hour = parseHour(val);
        if (hour === null) {
          await sendWhatsAppMessage(fromNumber, 'שלח מספר שעה, למשל: `שעות בוקר 8`');
        } else {
          await require('./supabase').updatePreferences(entity.user_id, { [type]: hour });
          await sendWhatsAppMessage(fromNumber, `✅ הודעת ${scheduleMatch[1]} תישלח ב-${hour}:00 כל יום`);
        }
      }
      return res.status(200).send('schedule-set');
    }

    // Skin/personality list command
    if (/^\/?(סקין|אישיות|שנה אישיות|בחר אישיות)$/i.test(incomingText)) {
      const current = entity.preferences?.voice_vibe || 'arsit';
      const p = PERSONALITIES[current] || { emoji: '✨', name: 'מותאם אישית' };
      const msg = `🎭 *בחר סקין לדמות*\n\nנוכחי: ${p.emoji} ${p.name}\n\n${listPersonalities()}`;
      await sendWhatsAppMessage(fromNumber, msg);
      return res.status(200).send('skin-list');
    }

    // Custom skin — start flow
    if (incomingText.trim() === 'מותאם') {
      await require('./supabase').updatePreferences(entity.user_id, { voice_vibe: 'מותאם', awaiting_custom_desc: true });
      await sendWhatsAppMessage(fromNumber, '✏️ *סקין מותאם אישית*\n\nתאר לי את הדמות שאתה רוצה — אישיות, סגנון דיבור, מאפיינים מיוחדים.\n\nלמשל: "רובוט ממאדים שמדבר בגוף שלישי ואוהב מתמטיקה"');
      return res.status(200).send('custom-start');
    }

    // Custom skin — receive description
    if (entity.preferences?.awaiting_custom_desc) {
      await require('./supabase').updatePreferences(entity.user_id, {
        voice_vibe: 'מותאם',
        custom_description: incomingText,
        awaiting_custom_desc: false,
      });
      await sendWhatsAppMessage(fromNumber, `✨ *סקין נשמר!*\n\nהדמות שלך: "${incomingText}"\n\nמעכשיו הדמות תדבר בסגנון הזה!`);
      return res.status(200).send('custom-saved');
    }

    // Switch to preset skin
    const personalityKeys = Object.keys(PERSONALITIES);
    if (personalityKeys.includes(incomingText.trim())) {
      const key = incomingText.trim();
      const p = PERSONALITIES[key];
      await require('./supabase').updatePreferences(entity.user_id, { voice_vibe: key, awaiting_custom_desc: false });
      await sendWhatsAppMessage(fromNumber, `${p.emoji} הסקין שונה ל*${p.name}*!`);
      return res.status(200).send('skin-changed');
    }

    // Respond to Twilio immediately — must be within 15s or it retries
    res.status(200).send('ok');

    // Process everything async so Twilio doesn't retry
    setImmediate(async () => {
    try {

    // Check if voice or GIF was requested
    const wantsVoice = VOICE_TRIGGER.test(incomingText);
    const wantsGif = /gif|גיף|תמונה|תמונת|איך אתה נראה|הראה לי/i.test(incomingText);

    await appendHistory(entity.user_id, 'user', incomingText);
    const history = await getRecentHistory(entity.user_id);
    const reply = await getEntityReply(entity, history, incomingText);

    const updatedState = applyAction(entity.entity_state, reply.action, reply.mood_delta);
    await updateEntityState(entity.user_id, updatedState);
    await appendHistory(entity.user_id, 'entity', reply.speech);

    if (wantsVoice) {
      await sendWhatsAppMessage(fromNumber, '🎙️ שניה...');
    } else {
      await sendWhatsAppMessage(fromNumber, reply.speech);
    }

    if (wantsGif) {
      try {
        const gifUrl = await getMoodGif(updatedState.happiness, updatedState.energy);
        if (gifUrl) {
          await sendWhatsAppMessage(fromNumber, `🎞️ ${gifUrl}`);
        }
      } catch (e) {
        console.error('GIF error:', e.message);
      }
    }

    if (wantsVoice) {
      try {
        const skinVoice = getPersonality(entity.preferences?.voice_vibe, entity.preferences?.custom_description)?.voice;
        const mp3Buffer = await textToSpeech(reply.speech, skinVoice);
        const filename = `voice_${entity.user_id}_${Date.now()}.mp3`;
        const audioUrl = await uploadAudio(mp3Buffer, filename);
        await sendWhatsAppAudio(fromNumber, audioUrl);
      } catch (voiceErr) {
        console.error('Voice generation error:', voiceErr.message);
      }
    }

    } catch (err) {
      console.error('Webhook processing error:', err);
    }
    }); // end setImmediate
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).send('error');
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

// Start scheduled morning/evening messages
startScheduler();

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
