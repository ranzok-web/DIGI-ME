const { supabase } = require('./supabase');

const BUCKET = 'audio';

/**
 * Ensure the audio bucket exists (creates it if it doesn't).
 * Call once at startup.
 */
async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets && buckets.find((b) => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error) throw new Error('Cannot create audio bucket: ' + error.message);
  }
}

/**
 * Upload an MP3 Buffer to Supabase Storage and return a public URL.
 */
async function uploadAudio(buffer, filename) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, { contentType: 'audio/mpeg', upsert: true });
  if (error) throw new Error('Storage upload error: ' + error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}

module.exports = { ensureBucket, uploadAudio };
