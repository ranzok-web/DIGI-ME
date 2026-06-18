const cron = require('node-cron');
const { getAllEntities } = require('./supabase');
const { sendWhatsAppMessage } = require('./twilio');
const { getEntityReply } = require('./claude');
const { appendHistory, getRecentHistory, updateEntityState } = require('./supabase');
const { applyAction } = require('./actions');

const MORNING_PROMPTS = [
  'שלח הודעת בוקר חמה ומתאימה לאישיות שלך',
  'התעוררת עכשיו — שלח הודעת בוקר',
  'בוקר חדש — פנה למשתמש בסגנון שלך',
];

const EVENING_PROMPTS = [
  'שלח הודעת ערב מתאימה לאישיות שלך',
  'הערב מתקרב — פנה למשתמש',
  'שלח סיכום יום קצר בסגנון האישיות שלך',
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function parseHour(str) {
  const n = parseInt(str, 10);
  return isNaN(n) ? null : Math.max(0, Math.min(23, n));
}

async function sendScheduledMessage(entity, promptText) {
  try {
    const history = await getRecentHistory(entity.user_id);
    const reply = await getEntityReply(entity, history, promptText);
    const updatedState = applyAction(entity.entity_state, reply.action, reply.mood_delta);
    await updateEntityState(entity.user_id, updatedState);
    await appendHistory(entity.user_id, 'entity', reply.speech);
    await sendWhatsAppMessage(entity.whatsapp_number, reply.speech);
    console.log(`Scheduled message sent to ${entity.whatsapp_number}`);
  } catch (e) {
    console.error(`Scheduled message error for ${entity.whatsapp_number}:`, e.message);
  }
}

function startScheduler() {
  // Run every hour at minute 0 — check all entities for scheduled messages
  cron.schedule('0 * * * *', async () => {
    const nowHour = new Date().getHours();
    try {
      const entities = await getAllEntities();
      for (const entity of entities) {
        const prefs = entity.preferences || {};
        if (prefs.schedule_morning !== undefined && prefs.schedule_morning === nowHour) {
          await sendScheduledMessage(entity, randomItem(MORNING_PROMPTS));
        }
        if (prefs.schedule_evening !== undefined && prefs.schedule_evening === nowHour) {
          await sendScheduledMessage(entity, randomItem(EVENING_PROMPTS));
        }
      }
    } catch (e) {
      console.error('Scheduler error:', e.message);
    }
  });

  console.log('Scheduler started — checking every hour');
}

module.exports = { startScheduler, parseHour };
