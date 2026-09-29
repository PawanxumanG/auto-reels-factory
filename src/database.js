const axios = require('axios');
const config = require('./config');

const DB_BASE = config.FIREBASE_DB_URL.replace(/\/+$/, '');

async function saveVideoRecord(record) {
  try {
    const id = Date.now().toString();
    await axios.put(`${DB_BASE}/shorts_factory/videos/${id}.json`, {
      ...record,
      createdAt: new Date().toISOString(),
    });
    return { success: true, id };
  } catch (err) {
    console.warn('[DB] Failed to save video record:', err.message);
    return { success: false };
  }
}

async function updateVideoRecord(id, updates) {
  try {
    await axios.patch(`${DB_BASE}/shorts_factory/videos/${id}.json`, updates);
    return { success: true };
  } catch (err) {
    console.warn('[DB] Failed to update video record:', err.message);
    return { success: false };
  }
}

async function deleteVideoRecord(id) {
  try {
    await axios.delete(`${DB_BASE}/shorts_factory/videos/${id}.json`);
    return { success: true };
  } catch (err) {
    console.warn('[DB] Failed to delete video record:', err.message);
    return { success: false };
  }
}

async function getRecentTopics() {
  try {
    const res = await axios.get(`${DB_BASE}/shorts_factory/videos.json?shallow=true`);
    if (!res.data) return [];
    return Object.keys(res.data);
  } catch (err) {
    return [];
  }
}

const DEFAULT_SETTINGS = {
  dailyUploadCount: 2,
  timeSlots: ['08:30', '17:30'],
  nicheRotation: ['psychology', 'facts', 'cricket', 'motivation'],
  voice: 'hi-IN-MadhurNeural',
  privacyStatus: 'public',
  autoPublish: true,
  pinnedComment: '👇 Which fact surprised you most? Drop your thoughts in the comments!',
  customTags: '#shorts #viral #trending #shortsfeed #facts #psychology',
};

async function getSettings() {
  try {
    const res = await axios.get(`${DB_BASE}/shorts_factory/settings.json`);
    if (!res.data) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...res.data };
  } catch (err) {
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(settings) {
  try {
    await axios.put(`${DB_BASE}/shorts_factory/settings.json`, settings);
    return { success: true, settings };
  } catch (err) {
    console.warn('[DB] Failed to save settings:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  saveVideoRecord,
  getRecentTopics,
  updateVideoRecord,
  deleteVideoRecord,
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS,
};
