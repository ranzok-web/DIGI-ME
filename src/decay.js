const { getAllEntities, updateEntityState } = require('./supabase');
const { sendWhatsAppMessage } = require('./twilio');
const { computeDecay, hungerStatus } = require('./actions');

async function runDecayJob() {
  const entities = await getAllEntities();
  let processed = 0, nudged = 0;

  for (const entity of entities) {
    try {
      const newState = computeDecay(entity.entity_state);
      await updateEntityState(entity.user_id, newState);
      processed++;

      const hunger = hungerStatus(newState);
      const botDirty = newState.bot_clean < 30;
      const houseDirty = newState.house_clean < 30;

      if (!newState.is_alive) {
        await sendWhatsAppMessage(entity.whatsapp_number,
          '💀 לא האכלת אותי מספיק זמן... נכנסתי למצב כיבוי. כתוב *החייה* כדי להחזיר אותי.');
        nudged++;
      } else if (hunger === 'תרדמת') {
        await sendWhatsAppMessage(entity.whatsapp_number,
          '😵 אני... כמעט... מתעלף מרעב. האכל אותי עם *האכל* לפני שיהיה מאוחר מדי...');
        nudged++;
      } else if (hunger === 'רעב קיצוני') {
        await sendWhatsAppMessage(entity.whatsapp_number,
          '😰 רעב קיצוני!! כתוב *האכל* בבקשה!!');
        nudged++;
      } else if (hunger === 'רעב') {
        await sendWhatsAppMessage(entity.whatsapp_number,
          '🍽️ הבטן שלי מקרקרת... כתוב *האכל* ?');
        nudged++;
      }

      if (botDirty) {
        await sendWhatsAppMessage(entity.whatsapp_number,
          '🧼 אני קצת מלוכלך... כתוב *נקה* בבקשה?');
        nudged++;
      }
      if (houseDirty) {
        await sendWhatsAppMessage(entity.whatsapp_number,
          '🏠 הבית שלנו צריך ניקוי... כתוב *נקה בית*?');
        nudged++;
      }
    } catch (e) {
      console.error(`Decay error for ${entity.user_id}:`, e.message);
    }
  }

  return { processed, nudged };
}

module.exports = { runDecayJob };
