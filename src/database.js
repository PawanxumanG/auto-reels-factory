const axios = require('axios');
const config = require('./config');

const DB_BASE = (config.FIREBASE_DB_URL || 'https://shorts-factory-6e290-default-rtdb.firebaseio.com').trim().replace(/\/+$/, '');

function getBasePath(userId, subpath) {
  if (userId && userId === 'admin') {
    return `${DB_BASE}/shorts_factory/${subpath}`;
  }
  if (userId) {
    return `${DB_BASE}/shorts_factory/users/${userId}/${subpath}`;
  }
  return null;
}

async function getVideos(userId = null) {
  try {
    const targetUid = userId || 'admin';
    const userPath = getBasePath(targetUid, 'videos.json');
    if (!userPath) return [];
    
    let list = [];
    const res = await axios.get(userPath).catch(() => ({ data: null }));
    if (res.data && typeof res.data === 'object') {
      list = Object.keys(res.data).map((k) => ({
        id: k,
        ...res.data[k],
      }));
    }

    // Also check root user path if any videos were saved at user root
    if (targetUid !== 'admin') {
      const rootRes = await axios.get(`${DB_BASE}/shorts_factory/users/${targetUid}.json`).catch(() => ({ data: null }));
      if (rootRes.data && typeof rootRes.data === 'object') {
        const reserved = ['profile', 'settings', 'youtube_auth', 'videos'];
        Object.keys(rootRes.data).forEach((k) => {
          if (!reserved.includes(k) && rootRes.data[k] && typeof rootRes.data[k] === 'object' && rootRes.data[k].title) {
            if (!list.find(item => item.id === k)) {
              list.push({
                id: k,
                ...rootRes.data[k],
              });
            }
          }
        });
      }
    }

    return list.reverse();
  } catch (err) {
    console.error('[DB] Failed to get videos:', err.message);
    return [];
  }
}

async function saveVideoRecord(record, userId = null) {
  try {
    const id = Date.now().toString();
    const targetUid = userId || 'admin';
    const payload = {
      ...record,
      userId: targetUid,
      createdAt: new Date().toISOString(),
    };
    
    // Save to user path
    const userPath = getBasePath(targetUid, `videos/${id}.json`);
    if (userPath) {
      await axios.put(userPath, payload);
    }

    return { success: true, id };
  } catch (err) {
    console.warn('[DB] Failed to save video record:', err.message);
    return { success: false };
  }
}

async function updateVideoRecord(id, updates, userId = null) {
  try {
    const targetUid = userId || 'admin';
    const userPath = getBasePath(targetUid, `videos/${id}.json`);
    if (userPath) {
      await axios.patch(userPath, updates);
    }
    return { success: true };
  } catch (err) {
    console.warn('[DB] Failed to update video record:', err.message);
    return { success: false };
  }
}

async function deleteVideoRecord(id, userId = null) {
  try {
    const targetUid = userId || 'admin';
    const userPath = getBasePath(targetUid, `videos/${id}.json`);
    if (userPath) {
      await axios.delete(userPath);
    }
    return { success: true };
  } catch (err) {
    console.warn('[DB] Failed to delete video record:', err.message);
    return { success: false };
  }
}

async function getRecentTopics(userId = null) {
  try {
    const targetUid = userId || 'admin';
    const userPath = getBasePath(targetUid, `videos.json?shallow=true`);
    if (!userPath) return [];
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
    const targetUid = userId || 'admin';
    const userPath = getBasePath(targetUid, `settings.json`);
    if (!userPath) return DEFAULT_SETTINGS;
    const res = await axios.get(userPath);
    if (!res.data) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...res.data };
  } catch (err) {
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(settings, userId = null) {
  try {
    const targetUid = userId || 'admin';
    const userPath = getBasePath(targetUid, `settings.json`);
    if (userPath) {
      await axios.put(userPath, settings);
    }
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

async function getUserYouTubeAuth(userId) {
  if (!userId) return null;
  try {
    const res = await axios.get(`${DB_BASE}/shorts_factory/users/${userId}/youtube_auth.json`);
    return res.data || null;
  } catch (err) {
    return null;
  }
}

async function saveUserYouTubeAuth(userId, authData) {
  if (!userId) return { success: false };
  try {
    await axios.put(`${DB_BASE}/shorts_factory/users/${userId}/youtube_auth.json`, {
      ...authData,
      linkedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Queue Management for Serverless <-> Worker Bridge
async function createJob(jobData) {
  try {
    const id = 'job_' + Date.now();
    const payload = {
      id,
      ...jobData,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await axios.put(`${DB_BASE}/shorts_factory/jobs/${id}.json`, payload);
    return { success: true, id, job: payload };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getPendingJobs() {
  try {
    const res = await axios.get(`${DB_BASE}/shorts_factory/jobs.json`);
    if (!res.data) return [];
    return Object.values(res.data).filter(j => j && j.status === 'pending');
  } catch (err) {
    return [];
  }
}

async function updateJobStatus(id, updates) {
  try {
    await axios.patch(`${DB_BASE}/shorts_factory/jobs/${id}.json`, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function getJobStatus(id) {
  try {
    const res = await axios.get(`${DB_BASE}/shorts_factory/jobs/${id}.json`);
    return res.data || null;
  } catch (err) {
    return null;
  }
}

module.exports = {
  saveVideoRecord,
  getVideos,
  getRecentTopics,
  updateVideoRecord,
  deleteVideoRecord,
  getSettings,
  saveSettings,
  getUserProfile,
  saveUserProfile,
  getUserYouTubeAuth,
  saveUserYouTubeAuth,
  createJob,
  getPendingJobs,
  updateJobStatus,
  getJobStatus,
  DEFAULT_SETTINGS,
};

