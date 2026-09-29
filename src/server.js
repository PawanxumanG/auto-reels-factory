const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cron = require('node-cron');
const config = require('./config');
const { generateScript } = require('./script_generator');
const { generateVoiceover } = require('./tts_engine');
const { fetchBackgroundVideo } = require('./video_fetcher');
const { renderShortVideo } = require('./video_renderer');
const {
  uploadToYouTube,
  getChannelInfo,
  getGoogleAuthUrl,
  exchangeCodeForTokens,
} = require('./youtube_uploader');
const {
  saveVideoRecord,
  getVideos,
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
} = require('./database');

const app = express();
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ASSETS_DIR = process.env.VERCEL ? path.join('/tmp', 'assets') : path.join(__dirname, '..', 'assets');

app.use(express.static(PUBLIC_DIR));
app.use('/assets', express.static(ASSETS_DIR));

// Active Cron Jobs List
let activeCronTasks = [];

/**
 * Re-arm the local auto-posting cron scheduler based on user settings
 */
async function syncScheduler() {
  activeCronTasks.forEach(task => task.stop());
  activeCronTasks = [];

  const settings = await getSettings();
  const timeSlots = settings.timeSlots || ['08:30', '17:30'];
  console.log(`[Scheduler] Initializing automation for ${timeSlots.length} daily time slots:`, timeSlots);

  timeSlots.forEach((slot, index) => {
    const parts = slot.trim().split(':');
    if (parts.length === 2) {
      const hour = parseInt(parts[0], 10);
      const minute = parseInt(parts[1], 10);
      if (!isNaN(hour) && !isNaN(minute)) {
        const cronPattern = `${minute} ${hour} * * *`;
        console.log(`[Scheduler] Setting active cron: "${cronPattern}" (Slot #${index + 1}: ${slot})`);
        
        const task = cron.schedule(cronPattern, async () => {
          console.log(`\n⏰ [Cron Triggered] Starting automated Short generation for slot: ${slot}...`);
          try {
            const currentSettings = await getSettings();
            const niches = currentSettings.nicheRotation || ['psychology', 'facts', 'cricket', 'motivation'];
            const chosenNiche = niches[Math.floor(Math.random() * niches.length)];
            await generateSingleShort({
              niche: chosenNiche,
              voice: currentSettings.voice || config.DEFAULT_VOICE,
              privacyStatus: currentSettings.privacyStatus || 'public',
              autoPublish: currentSettings.autoPublish !== false,
              pinnedComment: currentSettings.pinnedComment,
              customTags: currentSettings.customTags,
            });
          } catch (cronErr) {
            console.error('[Scheduler Execution Error]:', cronErr.message);
          }
        });

        activeCronTasks.push(task);
      }
    }
  });
}

/**
 * Core Single Short Generation Execution
 */
async function generateSingleShort(options = {}) {
  const targetNiche = options.niche || config.DEFAULT_NICHE;
  const targetVoice = options.voice || config.DEFAULT_VOICE;
  const userId = options.uid || options.userId || null;

  console.log(`[Auto Pipeline] Generating Short for niche: ${targetNiche} (User: ${userId || 'Default'})...`);

  // 1. Script
  const script = await generateScript(targetNiche, config.VIDEO_LANGUAGE, options.customTopic);

  // Check if running on serverless Lambda
  const isServerless = Boolean(process.env.VERCEL);
  if (isServerless) {
    const jobRes = await createJob({
      uid: userId,
      niche: targetNiche,
      voice: targetVoice,
      customTopic: options.customTopic,
      title: script.title,
      hook: script.hook,
      privacyStatus: options.privacyStatus || 'public',
    });

    const dbRecord = await saveVideoRecord({
      title: script.title,
      hook: script.hook,
      niche: targetNiche,
    return {
      success: true,
      isServerless: true,
      jobId: jobRes.id,
      title: script.title,
      hook: script.hook,
      message: '🚀 Viral Script crafted! Rendering & YouTube upload in progress...',
    };
  }

  const runId = Date.now();
  try {
    if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
  } catch (err) {}

  const tempAudio = path.join(ASSETS_DIR, `audio_${runId}.mp3`);
  const tempSub = path.join(ASSETS_DIR, `sub_${runId}.vtt`);
  const tempBg = path.join(ASSETS_DIR, `bg_${runId}.mp4`);
  const finalVideo = path.join(ASSETS_DIR, `Short_${runId}.mp4`);

  // Check if user has their own YouTube OAuth token
  let userAuth = null;
  if (userId) {
    userAuth = await getUserYouTubeAuth(userId);
  }
  const activeRefreshToken = userAuth?.refreshToken || (userId === 'admin' ? config.YOUTUBE_REFRESH_TOKEN : null);

  // 2. TTS
  await generateVoiceover(script.spoken_text, targetVoice, tempAudio, tempSub);

  // 3. Stock Background
  await fetchBackgroundVideo(script.pexels_query || 'abstract', tempBg);

  // 4. FFmpeg Render
  await renderShortVideo(tempBg, tempAudio, tempSub, finalVideo);

  // 5. YouTube Upload (if authorized)
  let youtubeResult = null;
  if (options.autoPublish !== false && activeRefreshToken) {
    youtubeResult = await uploadToYouTube(finalVideo, script, {
      refreshToken: activeRefreshToken,
      privacyStatus: options.privacyStatus || 'public',
      pinnedComment: options.pinnedComment,
      customTags: options.customTags,
    });
  }

  // 6. Save Record in Database
  await saveVideoRecord({
    title: script.title,
    hook: script.hook,
    niche: targetNiche,
    pexelsQuery: script.pexels_query,
    youtubeUrl: youtubeResult?.videoUrl || null,
    videoPath: finalVideo,
    privacyStatus: options.privacyStatus || 'public',
  }, userId);

  // Clean temp
  [tempAudio, tempSub, tempBg, tempSub.replace(/\.vtt$/, '.srt')].forEach((f) => {
    if (fs.existsSync(f)) {
      try { fs.unlinkSync(f); } catch {}
    }
  });

  return {
    success: true,
    title: script.title,
    youtubeUrl: youtubeResult?.videoUrl || null,
    videoUrl: `/assets/Short_${runId}.mp4`,
  };
}

// 1. Google OAuth Authorization URL
app.get('/api/auth/google-url', (req, res) => {
  const redirectUri = req.query.redirect_uri || `${req.protocol}://${req.get('host')}/api/auth/callback`;
  const url = getGoogleAuthUrl(redirectUri);
  res.json({ url });
});

// 1b. Google OAuth Web Redirect Callback
app.get('/api/auth/callback', (req, res) => {
  const code = req.query.code;
  const error = req.query.error;

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>YouTube Authorization Complete</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="background:#090d16;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
      <div style="text-align:center;padding:2.5rem;background:#131b2e;border-radius:18px;border:1px solid #ff2b6d40;max-width:420px;box-shadow:0 10px 30px rgba(0,0,0,0.5);">
        <div style="font-size:42px;margin-bottom:12px;">${error ? '⚠️' : '🎬'}</div>
        <h2 style="color:#ffffff;margin:0 0 8px;font-size:20px;">${error ? 'Authorization Cancelled' : 'YouTube Channel Connected!'}</h2>
        <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 16px;">
          ${error ? error : 'Authorization successful! Returning to your YouShorts Studio...'}
        </p>
        <script>
          if (window.opener) {
            window.opener.postMessage({
              type: 'GOOGLE_AUTH_CALLBACK',
              code: ${JSON.stringify(code || '')},
              error: ${JSON.stringify(error || '')}
            }, '*');
            setTimeout(() => window.close(), 1000);
          } else {
            document.body.innerHTML += '<p style="margin-top:1rem;color:#f43f5e;font-size:12px;">You can now close this tab.</p>';
          }
        </script>
      </div>
    </body>
    </html>
  `);
});

// 2. Google OAuth Callback / Exchange Code
app.post('/api/auth/google-callback', async (req, res) => {
  const { code, redirectUri, uid } = req.body;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  try {
    const fallbackRedirect = `${req.protocol}://${req.get('host')}/api/auth/callback`;
    const tokenData = await exchangeCodeForTokens(code, redirectUri || fallbackRedirect);
    if (uid) {
      await saveUserYouTubeAuth(uid, {
        refreshToken: tokenData.refreshToken,
        channel: tokenData.channelInfo,
      });
      await saveUserProfile(uid, {
        channel: tokenData.channelInfo,
      });
    }

    res.json({
      success: true,
      channel: tokenData.channelInfo,
    });
  } catch (err) {
    console.error('[OAuth Callback Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2b. Direct Refresh Token Linking
app.post('/api/auth/save-token', async (req, res) => {
  const { refreshToken, uid } = req.body;
  if (!refreshToken || !uid) return res.status(400).json({ error: 'Missing refreshToken or uid' });

  try {
    const channelInfo = await getChannelInfo(refreshToken.trim());
    await saveUserYouTubeAuth(uid, {
      refreshToken: refreshToken.trim(),
      channel: channelInfo,
    });
    await saveUserProfile(uid, {
      channel: channelInfo,
    });

    res.json({
      success: true,
      channel: channelInfo,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Get Channel Info for User or Global
app.get('/api/channel-info', async (req, res) => {
  const userId = req.query.uid || null;
  try {
    let refreshToken = null;
    if (userId && userId !== 'admin') {
      const userAuth = await getUserYouTubeAuth(userId);
      refreshToken = userAuth?.refreshToken;
      if (!refreshToken) {
        return res.json({ connected: false, title: null, handle: null, avatar: null });
      }
    } else if (userId === 'admin') {
      refreshToken = config.YOUTUBE_REFRESH_TOKEN;
    } else {
      return res.json({ connected: false, title: null, handle: null, avatar: null });
    }

    const info = await getChannelInfo(refreshToken);
    res.json(info);
  } catch (e) {
    res.json({ connected: false, title: null, handle: null, avatar: null });
  }
});

// 4. Get Stats (User Scoped or Admin)
app.get('/api/stats', async (req, res) => {
  const userId = req.query.uid || null;
  if (!userId) {
    return res.json({
      totalVideos: 0,
      youtubeVideos: 0,
      drafts: 0,
      dailyUploadCount: 2,
      timeSlots: ['08:30', '17:30'],
      aiOnline: true,
      pexelsOnline: true,
      youtubeConnected: false,
      channel: null,
    });
  }

  try {
    const videos = await getVideos(userId);
    const youtubeVideos = videos.filter((v) => Boolean(v.youtubeUrl)).length;
    const drafts = videos.length - youtubeVideos;
    const settings = await getSettings(userId);
    
    let userAuth = null;
    if (userId && userId !== 'admin') {
      userAuth = await getUserYouTubeAuth(userId);
    }
    const hasChannel = Boolean(userAuth?.refreshToken || (userId === 'admin' && config.YOUTUBE_REFRESH_TOKEN));

    res.json({
      totalVideos: videos.length,
      youtubeVideos,
      drafts,
      dailyUploadCount: settings.dailyUploadCount || 2,
      timeSlots: settings.timeSlots || ['08:30', '17:30'],
      aiOnline: true,
      pexelsOnline: true,
      youtubeConnected: hasChannel,
      channel: userAuth?.channel || (userId === 'admin' ? await getChannelInfo() : null),
    });
  } catch (err) {
    res.json({ totalVideos: 0, youtubeVideos: 0, drafts: 0, youtubeConnected: false });
  }
});

// 5. Get Video History (User Scoped or Admin)
app.get('/api/videos', async (req, res) => {
  const userId = req.query.uid || null;
  if (!userId) {
    return res.json({ videos: [] });
  }

  try {
    const rawVideos = await getVideos(userId);
    const videos = rawVideos.map((v) => {
      const filename = v.videoPath ? path.basename(v.videoPath) : null;
      return {
        ...v,
        videoUrl: filename ? `/assets/${filename}` : null,
      };
    });

    res.json({ videos });
  } catch (err) {
    res.json({ videos: [] });
  }
});

// 6. Get Settings
app.get('/api/settings', async (req, res) => {
  const userId = req.query.uid || null;
  try {
    const settings = await getSettings(userId);
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Save Settings
app.post('/api/settings', async (req, res) => {
  const userId = req.body.uid || null;
  try {
    const result = await saveSettings(req.body, userId);
    if (!userId) await syncScheduler();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. User Profile API
app.get('/api/user-profile', async (req, res) => {
  const userId = req.query.uid;
  if (!userId) return res.json({ profile: null });
  const profile = await getUserProfile(userId);
  res.json({ profile });
});

app.post('/api/user-profile', async (req, res) => {
  const { uid, profile } = req.body;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });
  const result = await saveUserProfile(uid, profile);
  res.json(result);
});

// 9. Generate Single Short
app.post('/api/generate', async (req, res) => {
  const userId = req.body.uid || null;
  try {
    const settings = await getSettings(userId);
    const result = await generateSingleShort({
      ...settings,
      ...req.body,
    });
    res.json(result);
  } catch (err) {
    console.error('[Dashboard Generator] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 10. Batch Generation
app.post('/api/trigger-batch', async (req, res) => {
  const userId = req.body.uid || null;
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 2, 1), 6);
  const settings = await getSettings(userId);
  const niches = settings.nicheRotation || ['psychology', 'facts', 'cricket', 'motivation'];

  res.json({ success: true, message: `Started batch generation for ${count} videos in background.` });

  (async () => {
    console.log(`\n🚀 [Batch Generator] Generating ${count} videos sequentially...`);
    for (let i = 0; i < count; i++) {
      const niche = niches[i % niches.length];
      console.log(`[Batch] Progress: Video ${i + 1}/${count} (Niche: ${niche})...`);
      try {
        await generateSingleShort({
          ...settings,
          niche,
          uid: userId,
        });
      } catch (e) {
        console.error(`[Batch Error on #${i + 1}]:`, e.message);
      }
    }
    console.log(`✅ [Batch Generator] Completed all ${count} videos!`);
  })();
});

// 11. Upload Local Draft to YouTube
app.post('/api/upload-draft', async (req, res) => {
  const { id, title, hook, niche, videoPath, uid } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing video ID' });

  try {
    const settings = await getSettings(uid);
    let userAuth = null;
    if (uid) userAuth = await getUserYouTubeAuth(uid);
    const activeRefreshToken = userAuth?.refreshToken || (uid === 'admin' ? config.YOUTUBE_REFRESH_TOKEN : null);

    const filePath = videoPath || path.join(ASSETS_DIR, `Short_${id}.mp4`);
    let targetFile = filePath;

    if (!fs.existsSync(filePath)) {
      const files = fs.readdirSync(ASSETS_DIR);
      const matched = files.find(f => f.includes(id) && f.endsWith('.mp4'));
      if (!matched) {
        return res.status(404).json({ error: 'Video file not found on local disk' });
      }
      targetFile = path.join(ASSETS_DIR, matched);
    }

    const scriptData = {
      title: title || 'Incredible Facts That Will Shock You #shorts',
      hook: hook || title,
      niche: niche || 'facts',
      tags: ['#shorts', '#viral', '#trending', '#facts', '#reels'],
      description: `${title}\n\nKey Facts you need to know today!`,
    };

    const ytResult = await uploadToYouTube(targetFile, scriptData, {
      refreshToken: activeRefreshToken,
      privacyStatus: settings.privacyStatus || 'public',
      pinnedComment: settings.pinnedComment,
      customTags: settings.customTags,
    });

    if (ytResult && ytResult.videoUrl) {
      await updateVideoRecord(id, { youtubeUrl: ytResult.videoUrl }, uid);
      return res.json({ success: true, youtubeUrl: ytResult.videoUrl });
    } else {
      return res.status(500).json({ error: 'YouTube upload failed. Check API authorization.' });
    }
  } catch (err) {
    console.error('[Upload Draft Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 12. Delete Video
app.post('/api/delete-video', async (req, res) => {
  const { id, videoPath, uid } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing video ID' });

  try {
    await deleteVideoRecord(id, uid);
    if (videoPath && fs.existsSync(videoPath)) {
      try { fs.unlinkSync(videoPath); } catch {}
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Job Status Route
app.get('/api/job-status', async (req, res) => {
  const jobId = req.query.id;
  if (!jobId) return res.status(400).json({ error: 'Missing jobId' });
  const status = await getJobStatus(jobId);
  res.json({ success: true, job: status });
});

let isWorkerBusy = false;
function startJobWorker() {
  console.log('[Worker] ⚡ Autonomous cloud rendering worker activated.');
  setInterval(async () => {
    if (isWorkerBusy) return;
    try {
      const pendingJobs = await getPendingJobs();
      if (!pendingJobs || pendingJobs.length === 0) return;

      const job = pendingJobs[0];
      isWorkerBusy = true;
      console.log(`\n⚡ [Cloud Worker] Picking up queued job ${job.id} for user ${job.uid || 'Anonymous'}...`);
      await updateJobStatus(job.id, { status: 'processing' });

      const result = await generateSingleShort({
        niche: job.niche,
        voice: job.voice,
        customTopic: job.customTopic,
        uid: job.uid,
        privacyStatus: job.privacyStatus || 'public',
      });

      await updateJobStatus(job.id, {
        status: 'completed',
        youtubeUrl: result.youtubeUrl,
        videoUrl: result.videoUrl,
        title: result.title,
      });

      console.log(`✅ [Cloud Worker] Finished job ${job.id}! Live URL: ${result.youtubeUrl || 'Draft saved'}`);
    } catch (err) {
      console.error('[Cloud Worker Error]:', err.message);
    } finally {
      isWorkerBusy = false;
    }
  }, 5000);
}

const PORT = process.env.PORT || 3500;
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, async () => {
    console.log(`============================================================`);
    console.log(`🖥️  AUTO SHORTS ADMIN STUDIO RUNNING AT: http://localhost:${PORT}`);
    console.log(`============================================================`);
    await syncScheduler();
    startJobWorker();
  });
}

module.exports = app;

