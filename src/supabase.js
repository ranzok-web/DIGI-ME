const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getOrCreateEntity(whatsappNumber) {
  const { data: existing, error: findErr } = await supabase
    .from('users_entities')
    .select('*')
    .eq('whatsapp_number', whatsappNumber)
    .maybeSingle();

  if (findErr) throw findErr;
  if (existing) return existing;

  const { data: created, error: createErr } = await supabase
    .from('users_entities')
    .insert({ whatsapp_number: whatsappNumber })
    .select('*')
    .single();

  if (createErr) throw createErr;
  return created;
}

async function updateEntityState(userId, partialState) {
  const { data: current, error: getErr } = await supabase
    .from('users_entities')
    .select('entity_state')
    .eq('user_id', userId)
    .single();
  if (getErr) throw getErr;

  const mergedState = { ...current.entity_state, ...partialState };

  const { data, error } = await supabase
    .from('users_entities')
    .update({ entity_state: mergedState })
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function appendHistory(userId, role, content) {
  const { error } = await supabase
    .from('conversation_history')
    .insert({ user_id: userId, role, content });
  if (error) throw error;
}

async function getRecentHistory(userId, limit = 12) {
  const { data, error } = await supabase
    .from('conversation_history')
    .select('role, content, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.reverse();
}

async function updatePreferences(userId, partialPrefs) {
  const { data: current, error: getErr } = await supabase
    .from('users_entities')
    .select('preferences')
    .eq('user_id', userId)
    .single();
  if (getErr) throw getErr;

  const merged = { ...current.preferences, ...partialPrefs };
  const { error } = await supabase
    .from('users_entities')
    .update({ preferences: merged })
    .eq('user_id', userId);
  if (error) throw error;
}

async function getAllEntities() {
  const { data, error } = await supabase.from('users_entities').select('*');
  if (error) throw error;
  return data;
}

module.exports = {
  supabase,
  getOrCreateEntity,
  updateEntityState,
  updatePreferences,
  appendHistory,
  getRecentHistory,
  getAllEntities,
};
