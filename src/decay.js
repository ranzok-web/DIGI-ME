// B. The Proactive Flow — scheduled decay + "entity needs you" nudges.
// Run this via an external scheduler (cron-job.org / Railway Cron / GitHub Actions)
// hitting POST /jobs/decay once or twice a day.
const { getAllEntities, updateEntityState } = require('./supabase');
const { sendWhatsAppMessage } = require('./twilio');

const DECAY_PER_HOUR = { happiness: 1, energy: 1.5 };
const NEED_THRESHOLD = 30;

function hoursSince(timestamp) {
  if (!timestamp) return 0;
  return (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60);
}

function clamp(n) {
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function runDecayJob() {
  const entities = await getAllEntities();
  let decayed = 0;
  let nudged = 0;

  for (const entity of entities) {
    const hours = hoursSince(entity.entity_state.last_interaction);
    if (hours <= 0) continue;

    const nextHappiness = clamp(entity.entity_state.happiness - DECAY_PER_HOUR.happiness * hours);
    const nextEnergy = clamp(entity.entity_state.energy - DECAY_PER_HOUR.energy * hours);

    const updated = await updateEntityState(entity.user_id, {
      happiness: nextHappiness,
      energy: nextEnergy,
    });
    decayed++;

    if (nextHappiness < NEED_THRESHOLD || nextEnergy < NEED_THRESHOLD) {
      try {
        await sendWhatsAppMessage(
          entity.whatsapp_number,
          'מתגעגע אליך... 🥺 לא אכלתי/שיחקתי כבר זמן מה. תבוא לבקר?'
        );
        nudged++;
      } catch (err) {
        console.error(`Failed to nudge ${entity.whatsapp_number}:`, err.message);
      }
    }
  }

  return { processed: entities.length, decayed, nudged };
}

module.exports = { runDecayJob };
