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
const { sendWhatsAppMessage } = require('./twilio');
const { runDecayJob } = require('./decay');

const app = express();
app.use(express.urlencoded({ extended: false })); // Twilio sends form-encoded webhooks
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// A. The Reactive Flow — WhatsApp inbound webhook (Twilio)
app.post('/webhook/whatsapp', async (req, res) => {
  try {
    const fromNumber = req.body.From; // e.g. "whatsapp:+9725xxxxxxx"
    const incomingText = (req.body.Body || '').trim();

    if (!fromNumber || !incomingText) {
      return res.status(200).send('ignored');
    }

    // Basic safety: simple "mute" command support per developer notes
    const entity = await getOrCreateEntity(fromNumber);

    if (/^\/?(mute|stop|השתק)$/i.test(incomingText)) {
      await updateEntityState(entity.user_id, {}); // no-op placeholder for mute flag if needed
      await sendWhatsAppMessage(fromNumber, 'הושתקתי בינתיים 🤐 כתבי/תכתוב לי "הקם אותי" כשתרצה שאחזור.');
      return res.status(200).send('muted');
    }

    await appendHistory(entity.user_id, 'user', incomingText);
    const history = await getRecentHistory(entity.user_id);

    const reply = await getEntityReply(entity, history, incomingText);

    const updatedState = applyAction(entity.entity_state, reply.action, reply.mood_delta);
    await updateEntityState(entity.user_id, updatedState);
    await appendHistory(entity.user_id, 'entity', reply.speech);

    await sendWhatsAppMessage(fromNumber, reply.speech);

    res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('error');
  }
});

// Manual trigger for the proactive decay job (also callable by an external scheduler/cron)
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
