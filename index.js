require('dotenv').config();
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const { generateScript } = require('./src/script_generator');
const { generateVoiceover } = require('./src/tts_engine');
const { fetchBackgroundVideo, fetchMultiSceneVideos } = require('./src/video_fetcher');
const { renderShortVideo } = require('./src/video_renderer');
const { uploadToYouTube } = require('./src/youtube_uploader');
const { sendToTelegram } = require('./src/telegram_sender');
const {
  saveVideoRecord,
  getSettings,
  getActiveYouTubeAuth,
  getPendingJobs,
  updateJobStatus,
} = require('./src/database');

async function runPipeline() {
  console.log('============================================================');
  console.log('🎬 AUTO REELS & YOUTUBE SHORTS FACTORY - PIPELINE STARTED');
  console.log('============================================================');

  // 1. Resolve Active Channel & User Token
  const activeAuth = await getActiveYouTubeAuth();
  const targetUid = activeAuth?.uid || null;
  const activeRefreshToken = activeAuth?.refreshToken || config.YOUTUBE_REFRESH_TOKEN;
  console.log(`👤 Active Target User: ${targetUid || 'Default / Admin'}`);
  console.log(`🔑 YouTube Channel Auth: ${activeRefreshToken ? '✅ Connected (' + activeRefreshToken.slice(0, 15) + '...)' : '❌ Not Configured'}`);

  // 2. Check for Queued Pending Jobs from Web Studio
  const pendingJobs = await getPendingJobs();
  let currentJob = null;
  if (pendingJobs && pendingJobs.length > 0) {
    currentJob = pendingJobs[0];
    console.log(`\n⚡ [Job Queue] Processing queued job: ${currentJob.id} (User: ${currentJob.uid || 'Anonymous'})...`);
    await updateJobStatus(currentJob.id, { status: 'processing' });
  }

  // 3. Resolve Execution Settings
  const settings = await getSettings(currentJob?.uid || targetUid);
  const niches = settings.nicheRotation || ['psychology', 'facts', 'technology', 'wealth', 'motivation'];
  const activeNiche = currentJob?.niche || niches[Math.floor(Math.random() * niches.length)] || config.DEFAULT_NICHE;
  const activeVoice = currentJob?.voice || settings.voice || config.DEFAULT_VOICE;
  const activeBgm = currentJob?.bgm || settings.bgm || config.DEFAULT_BGM;
  const enableMultiScene = (currentJob?.enableMultiScene !== undefined ? currentJob.enableMultiScene : settings.enableMultiScene) !== false && config.ENABLE_MULTI_SCENE;
  const customTopic = currentJob?.customTopic || null;
  const privacyStatus = currentJob?.privacyStatus || settings.privacyStatus || 'public';

  console.log(`⚡ Groq AI Model: ${config.GROQ_MODEL}`);
  console.log(`🌐 Niche: ${activeNiche}`);
  console.log(`🗣️ Voice: ${activeVoice}`);
  console.log(`🎵 Background Music: ${config.ENABLE_BGM ? activeBgm : 'Disabled'}`);
  console.log(`🎥 Dynamic Multi-Scene: ${enableMultiScene ? 'Enabled (3-4 B-Roll cuts)' : 'Single Clip'}`);
  console.log('------------------------------------------------------------');

  const runId = Date.now();
  const assetsDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const tempAudio = path.join(assetsDir, `audio_${runId}.mp3`);
  const tempSub = path.join(assetsDir, `sub_${runId}.vtt`);
  const tempBg = path.join(assetsDir, `bg_${runId}.mp4`);
  const finalVideo = path.join(assetsDir, `Short_${runId}.mp4`);
  let sceneClips = [];

  try {
    // 4. Generate Script via Groq AI
    console.log('\n[Step 1/5] Generating viral script with Groq AI...');
    const script = await generateScript(activeNiche, config.VIDEO_LANGUAGE, customTopic);
    console.log(`\n📌 Script Hook: "${script.hook}"`);
    console.log(`📝 Full Text: "${script.spoken_text}"\n`);

    // 5. Generate Voiceover & Subtitles via Edge-TTS
    console.log('[Step 2/5] Synthesizing voiceover with Edge-TTS...');
    await generateVoiceover(script.spoken_text, activeVoice, tempAudio, tempSub);

    // 6. Fetch HD Vertical Video from Pexels (Multi-scene or single)
    console.log('[Step 3/5] Fetching cinematic vertical footage from Pexels...');
    let bgVideoInputs = [];
    if (enableMultiScene && script.visual_scenes && script.visual_scenes.length > 0) {
      console.log('🎬 Engaging Multi-Scene B-Roll montage generator...');
      const multiClips = await fetchMultiSceneVideos(script.visual_scenes, assetsDir, 3);
      sceneClips = multiClips.map((c) => c.videoPath);
      bgVideoInputs = sceneClips;
    } else {
      await fetchBackgroundVideo(script.pexels_query || 'dark moody nature', tempBg);
      bgVideoInputs = [tempBg];
    }

    // 7. Render Final 1080x1920 Short via FFmpeg (with BGM and Subtitles)
    console.log('[Step 4/5] Rendering final high-retention video with FFmpeg...');
    await renderShortVideo(bgVideoInputs, tempAudio, tempSub, finalVideo, {
      enableBgm: config.ENABLE_BGM,
      bgm: activeBgm,
      bgmVolume: config.BGM_VOLUME,
    });

    // 8. Upload to YouTube (with Active User Refresh Token)
    console.log('[Step 5/5] Publishing and delivering video...');
    let youtubeResult = null;
    if (activeRefreshToken) {
      youtubeResult = await uploadToYouTube(finalVideo, script, {
        refreshToken: activeRefreshToken,
        privacyStatus,
        pinnedComment: settings.pinnedComment,
        customTags: settings.customTags,
      });
    } else {
      console.warn('[YouTube] No active refresh token available. Saving video as local draft.');
    }

    // 9. Deliver to Telegram
    if (config.ENABLE_TELEGRAM && config.TELEGRAM_BOT_TOKEN) {
      try {
        console.log('📱 Sending video directly to Telegram channel/bot...');
        await sendToTelegram(finalVideo, script, youtubeResult?.videoUrl);
      } catch (tgErr) {
        console.warn('[Telegram Delivery Notice]:', tgErr.message);
      }
    }

    // 10. Save Video Record in Database
    await saveVideoRecord({
      title: script.title,
      hook: script.hook,
      niche: activeNiche,
      pexelsQuery: script.pexels_query,
      youtubeUrl: youtubeResult?.videoUrl || null,
      videoPath: finalVideo,
      privacyStatus,
    }, currentJob?.uid || targetUid);

    // 11. Update Job Status if picking up from queue
    if (currentJob) {
      await updateJobStatus(currentJob.id, {
        status: 'completed',
        youtubeUrl: youtubeResult?.videoUrl || null,
        videoUrl: `/assets/Short_${runId}.mp4`,
        title: script.title,
        hook: script.hook,
      });
      console.log(`✅ [Job Queue] Successfully finished and updated job ${currentJob.id}!`);
    }

    console.log('============================================================');
    console.log('🎉 PIPELINE COMPLETED SUCCESSFULLY!');
    console.log(`📁 Final Output: ${finalVideo}`);
    if (youtubeResult?.videoUrl) {
      console.log(`🔗 YouTube Live: ${youtubeResult.videoUrl}`);
    }
    console.log('============================================================');

    // Clean up temp intermediate files
    [tempAudio, tempSub, tempBg, tempSub.replace(/\.vtt$/, '.srt'), ...sceneClips].forEach((f) => {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
        } catch {}
      }
    });

    return { success: true, finalVideo, script, youtube: youtubeResult };
  } catch (err) {
    console.error('\n❌ Pipeline Failed:', err);
    if (currentJob) {
      await updateJobStatus(currentJob.id, {
        status: 'failed',
        error: err.message,
      });
    }
    process.exit(1);
  }
}

if (require.main === module) {
  runPipeline();
}

module.exports = {
  runPipeline,
};
