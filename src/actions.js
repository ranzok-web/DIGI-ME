// Translates a care action + Claude's mood_delta into a concrete stat update.
function clamp(n) {
  return Math.max(0, Math.min(100, n));
}

const ACTION_EFFECTS = {
  feed: { energy: 15, happiness: 5 },
  clean: { happiness: 10 },
  play: { happiness: 15, energy: -5, bond: 5 },
  sleep: { energy: 20 },
  none: {},
};

function applyAction(currentState, action, moodDelta = {}) {
  const effect = ACTION_EFFECTS[action] || {};
  const next = { ...currentState };

  for (const key of ['happiness', 'energy', 'bond']) {
    const delta = (effect[key] || 0) + (moodDelta[key] || 0);
    next[key] = clamp((currentState[key] || 0) + delta);
  }
  next.last_interaction = new Date().toISOString();
  return next;
}

module.exports = { applyAction };
