function clamp(n) {
  return Math.max(0, Math.min(100, n));
}

function hoursSince(ts) {
  if (!ts) return 999;
  return (Date.now() - new Date(ts).getTime()) / 3600000;
}

// Default values for new entities
const DEFAULT_STATE = {
  happiness: 80,
  energy: 80,
  bond: 50,
  hunger: 100,
  bot_clean: 100,
  house_clean: 100,
  is_alive: true,
  last_interaction: null,
  last_fed: null,
  last_bot_cleaned: null,
  last_house_cleaned: null,
};

function applyAction(currentState, action, moodDelta = {}) {
  const state = { ...DEFAULT_STATE, ...currentState };
  const now = new Date().toISOString();

  // Mood delta from Claude
  for (const key of ['happiness', 'energy', 'bond']) {
    state[key] = clamp(state[key] + (moodDelta[key] || 0));
  }
  state.last_interaction = now;

  // Care actions
  if (action === 'feed') {
    state.hunger = 100;
    state.last_fed = now;
    state.happiness = clamp(state.happiness + 10);
  }
  if (action === 'clean') {
    state.bot_clean = 100;
    state.last_bot_cleaned = now;
    state.happiness = clamp(state.happiness + 8);
  }
  if (action === 'clean_house') {
    state.house_clean = 100;
    state.last_house_cleaned = now;
    state.bond = clamp(state.bond + 5);
  }
  if (action === 'play') {
    state.happiness = clamp(state.happiness + 15);
    state.energy = clamp(state.energy - 5);
    state.bond = clamp(state.bond + 5);
  }
  if (action === 'sleep') {
    state.energy = clamp(state.energy + 20);
  }
  if (action === 'revive') {
    state.is_alive = true;
    state.hunger = 50;
    state.happiness = 30;
    state.energy = 30;
    state.last_fed = now;
  }

  return state;
}

/**
 * Compute derived stats based on time elapsed since last care.
 * Called by decay job — updates hunger/cleanliness and their effects on happiness/bond.
 */
function computeDecay(state) {
  const s = { ...DEFAULT_STATE, ...state };
  if (!s.is_alive) return s;

  const hoursSinceFed = hoursSince(s.last_fed);
  const hoursSinceBotClean = hoursSince(s.last_bot_cleaned);
  const daysSinceHouseClean = hoursSince(s.last_house_cleaned) / 24;

  // Hunger decay
  if (hoursSinceFed >= 36) {
    s.is_alive = false;
    s.hunger = 0;
    s.happiness = 0;
  } else if (hoursSinceFed >= 12) {
    s.hunger = 0;
    s.happiness = clamp(s.happiness - 30);
    s.energy = clamp(s.energy - 20);
  } else if (hoursSinceFed >= 7) {
    s.hunger = clamp(100 - (hoursSinceFed / 36) * 100);
    s.happiness = clamp(s.happiness - 15);
  } else if (hoursSinceFed >= 5) {
    s.hunger = clamp(100 - (hoursSinceFed / 36) * 100);
    s.happiness = clamp(s.happiness - 8);
  } else if (hoursSinceFed >= 3) {
    s.hunger = clamp(100 - (hoursSinceFed / 36) * 100);
  }

  // Bot cleanliness decay — drops ~15/day
  s.bot_clean = clamp(100 - (hoursSinceBotClean / 24) * 15);
  if (s.bot_clean < 30) s.happiness = clamp(s.happiness - 5);

  // House cleanliness decay — drops ~15/day (full dirty in ~7 days)
  s.house_clean = clamp(100 - daysSinceHouseClean * 15);
  if (s.house_clean < 30) s.bond = clamp(s.bond - 3);

  return s;
}

function hungerStatus(state) {
  const h = hoursSince(state.last_fed);
  if (!state.is_alive) return 'מת';
  if (h >= 12) return 'תרדמת';
  if (h >= 7) return 'רעב קיצוני';
  if (h >= 5) return 'רעב';
  if (h >= 3) return 'קצת רעב';
  return 'שבע';
}

module.exports = { applyAction, computeDecay, hungerStatus, DEFAULT_STATE };
