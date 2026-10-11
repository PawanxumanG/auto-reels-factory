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
const { saveVideoRecord, getSettings } = require('./src/database');

async function runPipeline() {
  const settings = await getSettings();
  const niches = settings.nicheRotation || ['psychology', 'facts', 'technology', 'wealth', 'motivation'];
  const activeNiche = niches[Math.floor(Math.random() * niches.length)] || config.DEFAULT_NICHE;
  const activeVoice = settings.voice || config.DEFAULT_VOICE;
  const activeBgm = settings.bgm || config.DEFAULT_BGM;
  const enableMultiScene = settings.enableMultiScene !== false && config.ENABLE_MULTI_SCENE;

  console.log('============================================================');
  console.log('🎬 AUTO REELS & YOUTUBE SHORTS FACTORY - PIPELINE STARTED');
  console.log('============================================================');
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
    // 1. Generate Script via Groq AI
    console.log('\n[Step 1/5] Generating viral script with Groq AI...');
    const script = await generateScript(activeNiche, config.VIDEO_LANGUAGE);
    console.log(`\n📌 Script Hook: "${script.hook}"`);
    console.log(`📝 Full Text: "${script.spoken_text}"\n`);

    // 2. Generate Voiceover & Subtitles via Edge-TTS
    console.log('[Step 2/5] Synthesizing voiceover with Edge-TTS...');
    await generateVoiceover(script.spoken_text, activeVoice, tempAudio, tempSub);

    // 3. Fetch HD Vertical Video from Pexels (Multi-scene or single)
    console.log('[Step 3/5] Fetching cinematic vertical footage from Pexels...');
    let bgVideoInputs = [];
    if (config.ENABLE_MULTI_SCENE && script.visual_scenes && script.visual_scenes.length > 0) {
      console.log('🎬 Engaging Multi-Scene B-Roll montage generator...');
      const multiClips = await fetchMultiSceneVideos(script.visual_scenes, assetsDir, 3);
      sceneClips = multiClips.map((c) => c.videoPath);
      bgVideoInputs = sceneClips;
    } else {
      await fetchBackgroundVideo(script.pexels_query || 'dark moody nature', tempBg);
      bgVideoInputs = [tempBg];
    }

    // 4. Render Final 1080x1920 Short via FFmpeg (with BGM and Subtitles)
    console.log('[Step 4/5] Rendering final high-retention video with FFmpeg...');
    await renderShortVideo(bgVideoInputs, tempAudio, tempSub, finalVideo, {
      enableBgm: config.ENABLE_BGM,
      bgm: config.DEFAULT_BGM,
      bgmVolume: config.BGM_VOLUME,
    });

    // 5. Upload to YouTube (if credentials present)
    console.log('[Step 5/5] Publishing and delivering video...');
    let youtubeResult = null;
    if (config.YOUTUBE_CLIENT_ID && config.YOUTUBE_REFRESH_TOKEN) {
      youtubeResult = await uploadToYouTube(finalVideo, script);
    }

    // 5b. Telegram Delivery
    if (config.ENABLE_TELEGRAM && config.TELEGRAM_BOT_TOKEN) {
      try {
        console.log('📱 Sending video directly to Telegram channel/bot...');
        await sendToTelegram(finalVideo, script, youtubeResult?.videoUrl);
      } catch (tgErr) {
        console.warn('[Telegram] Delivery notice:', tgErr.message);
      }
    }

    // 6. Save Record in Firebase RTDB
    await saveVideoRecord({
      title: script.title,
      hook: script.hook,
      niche: config.DEFAULT_NICHE,
      pexelsQuery: script.pexels_query,
      youtubeUrl: youtubeResult?.videoUrl || null,
      videoPath: finalVideo,
    });

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
    process.exit(1);
  }
}

if (require.main === module) {
  runPipeline();
}

module.exports = {
  runPipeline,
};
