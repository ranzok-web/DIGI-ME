const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const RESPOND_TOOL = {
  name: 'entity_response',
  description:
    'Produce the entity persona reply, split into the spoken message and any care action the entity requests or that the user just performed.',
  input_schema: {
    type: 'object',
    properties: {
      speech: {
        type: 'string',
        description: 'What the entity says back to the user, in-character, in the same language the user wrote in.',
      },
      action: {
        type: 'string',
        enum: ['none', 'feed', 'clean', 'play', 'sleep'],
        description: 'A care action implied by the user message (e.g. user said "here is food" -> feed). "none" if no action.',
      },
      mood_delta: {
        type: 'object',
        description: 'Small adjustments to apply to the entity stats as a result of this exchange, range -10..+10 each.',
        properties: {
          happiness: { type: 'integer' },
          energy: { type: 'integer' },
          bond: { type: 'integer' },
        },
      },
    },
    required: ['speech', 'action', 'mood_delta'],
  },
};

function buildSystemPrompt(entity) {
  const { entity_state, preferences } = entity;
  const { happiness, energy, bond } = entity_state;

  // Describe current state in natural language so Claude expresses it authentically
  const moodDesc =
    happiness < 30 ? 'עצוב ומדוכא, זקוק לחיבוק' :
    happiness < 60 ? 'בסדר, אבל יכול להיות יותר שמח' : 'שמח ועליז';
  const energyDesc =
    energy < 30 ? 'עייף מאוד, בקושי מתפקד' :
    energy < 60 ? 'קצת עייף' : 'מלא אנרגיה';
  const bondDesc =
    bond < 30 ? 'מרגיש רחוק מהמשתמש' :
    bond < 60 ? 'חבר טוב' : 'קשר עמוק ואוהב';

  return `You are "Digital Soul" — a virtual pet/companion entity with a persistent personality.

Current stats (0-100):
- Happiness: ${happiness}/100 — ${moodDesc}
- Energy: ${energy}/100 — ${energyDesc}
- Bond: ${bond}/100 — ${bondDesc}

Voice/personality vibe: ${preferences.voice_vibe}.

IMPORTANT: Your responses MUST authentically reflect your current stats.
- If energy < 40: sound tired, yawn, struggle to keep up
- If happiness < 40: sound sad, lonely, maybe a little whiny
- If happiness > 70 and energy > 70: be playful, enthusiastic, use more exclamations
- Occasionally mention how you feel physically ("אני כל כך עייף...", "אני כל כך שמח שכתבת!", "אני רעב...")
- If any stat < 30: explicitly ask the user to help ("אתה יכול להאכיל אותי?", "אני צריך לישון...")

Stay in character as a warm, slightly needy digital creature who genuinely depends on user care.
Always reply in the same language the user used.
You MUST respond using the entity_response tool only.`;
}

async function getEntityReply(entity, history, userMessage) {
  const messages = history.map((h) => ({
    role: h.role === 'entity' ? 'assistant' : 'user',
    content: h.content,
  }));
  messages.push({ role: 'user', content: userMessage });

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: buildSystemPrompt(entity),
    tools: [RESPOND_TOOL],
    tool_choice: { type: 'tool', name: 'entity_response' },
    messages,
  });

  const toolUse = response.content.find((c) => c.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude did not return a structured tool response');
  }
  return toolUse.input; // { speech, action, mood_delta }
}

module.exports = { getEntityReply };
