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
const { uploadToYouTube } = require('./youtube_uploader');
const {
  saveVideoRecord,
  updateVideoRecord,
  deleteVideoRecord,
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS,
} = require('./database');

const app = express();
app.use(express.json());

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

app.use(express.static(PUBLIC_DIR));
app.use('/assets', express.static(ASSETS_DIR));

// Active Cron Jobs List
let activeCronTasks = [];

/**
 * Re-arm the local auto-posting cron scheduler based on user settings
 */
async function syncScheduler() {
  // Stop existing tasks
  activeCronTasks.forEach(task => task.stop());
  activeCronTasks = [];

  const settings = await getSettings();
  const timeSlots = settings.timeSlots || ['08:30', '17:30'];
  console.log(`[Scheduler] Initializing local automation for ${timeSlots.length} daily time slots:`, timeSlots);

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

  const runId = Date.now();
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const tempAudio = path.join(ASSETS_DIR, `audio_${runId}.mp3`);
  const tempSub = path.join(ASSETS_DIR, `sub_${runId}.vtt`);
  const tempBg = path.join(ASSETS_DIR, `bg_${runId}.mp4`);
  const finalVideo = path.join(ASSETS_DIR, `Short_${runId}.mp4`);

  console.log(`[Auto Pipeline] Generating Short for niche: ${targetNiche}...`);

  // 1. Script
  const script = await generateScript(targetNiche, config.VIDEO_LANGUAGE, options.customTopic);

  // 2. TTS
  await generateVoiceover(script.spoken_text, targetVoice, tempAudio, tempSub);

  // 3. Stock Background
  await fetchBackgroundVideo(script.pexels_query || 'abstract', tempBg);

  // 4. FFmpeg Render
  await renderShortVideo(tempBg, tempAudio, tempSub, finalVideo);

  // 5. YouTube Upload (if autoPublish is enabled)
  let youtubeResult = null;
  if (options.autoPublish !== false && config.YOUTUBE_CLIENT_ID && config.YOUTUBE_REFRESH_TOKEN) {
    youtubeResult = await uploadToYouTube(finalVideo, script, {
      privacyStatus: options.privacyStatus || 'public',
      pinnedComment: options.pinnedComment,
      customTags: options.customTags,
    });
  }

  // 6. Save Record
  await saveVideoRecord({
    title: script.title,
    hook: script.hook,
    niche: targetNiche,
    pexelsQuery: script.pexels_query,
    youtubeUrl: youtubeResult?.videoUrl || null,
    videoPath: finalVideo,
    privacyStatus: options.privacyStatus || 'public',
  });

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

// 1. Get Stats
app.get('/api/stats', async (req, res) => {
  try {
    const dbRes = await axios.get(`${config.FIREBASE_DB_URL.replace(/\/+$/, '')}/shorts_factory/videos.json`).catch(() => ({ data: {} }));
    const videos = dbRes.data ? Object.values(dbRes.data) : [];
    
    const youtubeVideos = videos.filter((v) => Boolean(v.youtubeUrl)).length;
    const drafts = videos.length - youtubeVideos;
    const settings = await getSettings();

    res.json({
      totalVideos: videos.length,
      youtubeVideos,
      drafts,
      dailyUploadCount: settings.dailyUploadCount || 2,
      timeSlots: settings.timeSlots || ['08:30', '17:30'],
      aiOnline: true,
      pexelsOnline: true,
      youtubeConnected: Boolean(config.YOUTUBE_REFRESH_TOKEN),
    });
  } catch (err) {
    res.json({ totalVideos: 0, youtubeVideos: 0, drafts: 0 });
  }
});

// 2. Get Video History
app.get('/api/videos', async (req, res) => {
  try {
    const dbRes = await axios.get(`${config.FIREBASE_DB_URL.replace(/\/+$/, '')}/shorts_factory/videos.json`).catch(() => ({ data: {} }));
    if (!dbRes.data) return res.json({ videos: [] });

    const videos = Object.keys(dbRes.data).map((k) => {
      const v = dbRes.data[k];
      const filename = v.videoPath ? path.basename(v.videoPath) : null;
      return {
        id: k,
        ...v,
        videoUrl: filename ? `/assets/${filename}` : null,
      };
    }).reverse();

    res.json({ videos });
  } catch (err) {
    res.json({ videos: [] });
  }
});

// 3. Get Settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Save Settings
app.post('/api/settings', async (req, res) => {
  try {
    const result = await saveSettings(req.body);
    await syncScheduler();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Generate Single Short
app.post('/api/generate', async (req, res) => {
  try {
    const settings = await getSettings();
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

// 6. Batch Generation
app.post('/api/trigger-batch', async (req, res) => {
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 2, 1), 6);
  const settings = await getSettings();
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
        });
      } catch (e) {
        console.error(`[Batch Error on #${i + 1}]:`, e.message);
      }
    }
    console.log(`✅ [Batch Generator] Completed all ${count} videos!`);
  })();
});

// 7. Upload Local Draft to YouTube
app.post('/api/upload-draft', async (req, res) => {
  const { id, title, hook, niche, videoPath } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing video ID' });

  try {
    const settings = await getSettings();
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
      privacyStatus: settings.privacyStatus || 'public',
      pinnedComment: settings.pinnedComment,
      customTags: settings.customTags,
    });

    if (ytResult && ytResult.videoUrl) {
      await updateVideoRecord(id, { youtubeUrl: ytResult.videoUrl });
      return res.json({ success: true, youtubeUrl: ytResult.videoUrl });
    } else {
      return res.status(500).json({ error: 'YouTube upload failed. Check API quota.' });
    }
  } catch (err) {
    console.error('[Upload Draft Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 8. Delete Video
app.post('/api/delete-video', async (req, res) => {
  const { id, videoPath } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing video ID' });

  try {
    await deleteVideoRecord(id);
    if (videoPath && fs.existsSync(videoPath)) {
      try { fs.unlinkSync(videoPath); } catch {}
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3500;
app.listen(PORT, async () => {
  console.log(`============================================================`);
  console.log(`🖥️  AUTO SHORTS ADMIN STUDIO RUNNING AT: http://localhost:${PORT}`);
  console.log(`============================================================`);
  await syncScheduler();
});
