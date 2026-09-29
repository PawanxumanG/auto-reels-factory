require('dotenv').config();
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const { generateScript } = require('./src/script_generator');
const { generateVoiceover } = require('./src/tts_engine');
const { fetchBackgroundVideo } = require('./src/video_fetcher');
const { renderShortVideo } = require('./src/video_renderer');
const { uploadToYouTube } = require('./src/youtube_uploader');
const { saveVideoRecord } = require('./src/database');

async function runPipeline() {
  console.log('============================================================');
  console.log('🎬 AUTO REELS & YOUTUBE SHORTS FACTORY - PIPELINE STARTED');
  console.log('============================================================');
  console.log(`⚡ Groq AI Model: ${config.GROQ_MODEL}`);
  console.log(`🌐 Niche: ${config.DEFAULT_NICHE}`);
  console.log(`🗣️ Voice: ${config.DEFAULT_VOICE}`);
  console.log('------------------------------------------------------------');

  const runId = Date.now();
  const assetsDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const tempAudio = path.join(assetsDir, `audio_${runId}.mp3`);
  const tempSub = path.join(assetsDir, `sub_${runId}.vtt`);
  const tempBg = path.join(assetsDir, `bg_${runId}.mp4`);
  const finalVideo = path.join(assetsDir, `Short_${runId}.mp4`);

  try {
    // 1. Generate Script via Groq AI
    console.log('\n[Step 1/5] Generating viral script with Groq AI...');
    const script = await generateScript(config.DEFAULT_NICHE, config.VIDEO_LANGUAGE);
    console.log(`\n📌 Script Hook: "${script.hook}"`);
    console.log(`📝 Full Text: "${script.spoken_text}"\n`);

    // 2. Generate Voiceover & Subtitles via Edge-TTS
    console.log('[Step 2/5] Synthesizing voiceover with Edge-TTS...');
    await generateVoiceover(script.spoken_text, config.DEFAULT_VOICE, tempAudio, tempSub);

    // 3. Fetch HD Vertical Video from Pexels
    console.log('[Step 3/5] Fetching background video from Pexels...');
    await fetchBackgroundVideo(script.pexels_query || 'nature', tempBg);

    // 4. Render Final 1080x1920 Short via FFmpeg
    console.log('[Step 4/5] Rendering final video with FFmpeg...');
    await renderShortVideo(tempBg, tempAudio, tempSub, finalVideo);

    // 5. Upload to YouTube (if credentials present)
    console.log('[Step 5/5] Publishing and delivering video...');
    let youtubeResult = null;
    if (config.YOUTUBE_CLIENT_ID && config.YOUTUBE_REFRESH_TOKEN) {
      youtubeResult = await uploadToYouTube(finalVideo, script);
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
    [tempAudio, tempSub, tempBg, tempSub.replace(/\.vtt$/, '.srt')].forEach((f) => {
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
