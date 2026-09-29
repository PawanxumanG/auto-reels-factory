const axios = require('axios');
const config = require('./config');

const DB_BASE = config.FIREBASE_DB_URL.replace(/\/+$/, '');

function getBasePath(userId, subpath) {
  if (userId && userId !== 'admin' && userId !== 'default') {
    return `${DB_BASE}/shorts_factory/users/${userId}/${subpath}`;
  }
  return `${DB_BASE}/shorts_factory/${subpath}`;
}

async function saveVideoRecord(record, userId = null) {
  try {
    const id = Date.now().toString();
    const payload = {
      ...record,
      userId: userId || 'admin',
      createdAt: new Date().toISOString(),
    };
    
    // Save to user path
    const userPath = getBasePath(userId, `videos/${id}.json`);
    await axios.put(userPath, payload);

    // If specific user, also log in global index
    if (userId && userId !== 'admin') {
      await axios.put(`${DB_BASE}/shorts_factory/videos/${id}.json`, payload).catch(() => {});
    }

    return { success: true, id };
  } catch (err) {
    console.warn('[DB] Failed to save video record:', err.message);
    return { success: false };
  }
}

async function updateVideoRecord(id, updates, userId = null) {
  try {
    const userPath = getBasePath(userId, `videos/${id}.json`);
    await axios.patch(userPath, updates);
    return { success: true };
  } catch (err) {
    console.warn('[DB] Failed to update video record:', err.message);
    return { success: false };
  }
}

async function deleteVideoRecord(id, userId = null) {
  try {
    const userPath = getBasePath(userId, `videos/${id}.json`);
    await axios.delete(userPath);
    return { success: true };
  } catch (err) {
    console.warn('[DB] Failed to delete video record:', err.message);
    return { success: false };
  }
}

async function getRecentTopics(userId = null) {
  try {
    const userPath = getBasePath(userId, `videos.json?shallow=true`);
    const res = await axios.get(userPath);
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

async function getSettings(userId = null) {
  try {
    const userPath = getBasePath(userId, `settings.json`);
    const res = await axios.get(userPath);
    if (!res.data) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...res.data };
  } catch (err) {
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(settings, userId = null) {
  try {
    const userPath = getBasePath(userId, `settings.json`);
    await axios.put(userPath, settings);
    return { success: true, settings };
  } catch (err) {
    console.warn('[DB] Failed to save settings:', err.message);
    return { success: false, error: err.message };
  }
}

async function getUserProfile(userId) {
  if (!userId) return null;
  try {
    const res = await axios.get(`${DB_BASE}/shorts_factory/users/${userId}/profile.json`);
    return res.data || null;
  } catch (err) {
    return null;
  }
}

async function saveUserProfile(userId, profile) {
  if (!userId) return { success: false };
  try {
    await axios.patch(`${DB_BASE}/shorts_factory/users/${userId}/profile.json`, {
      ...profile,
      updatedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (err) {
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
  getUserProfile,
  saveUserProfile,
  DEFAULT_SETTINGS,
};
