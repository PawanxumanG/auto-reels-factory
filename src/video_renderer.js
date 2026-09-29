const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Convert VTT to SRT for seamless FFmpeg subtitle burning
 */
function convertVttToSrt(vttPath, srtPath) {
  const vttContent = fs.readFileSync(vttPath, 'utf8');
  // Remove WEBVTT header and fix timestamp commas
  const srtContent = vttContent
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2')
    .trim();
  fs.writeFileSync(srtPath, srtContent, 'utf8');
  return srtPath;
}

/**
 * Render Final 1080x1920 Short with Subtitles and Audio via FFmpeg
 * @param {string} bgVideoPath 
 * @param {string} audioPath 
 * @param {string} subPath 
 * @param {string} outputVideoPath 
 */
async function renderShortVideo(bgVideoPath, audioPath, subPath, outputVideoPath) {
  const finalOutput = outputVideoPath || path.join(__dirname, '..', 'assets', `final_short_${Date.now()}.mp4`);
  const srtPath = subPath.replace(/\.vtt$/i, '.srt');
  convertVttToSrt(subPath, srtPath);

  // Absolute path formatted for FFmpeg subtitle filter
  const escapedSrtPath = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

  console.log(`[FFmpeg] Rendering finalized 1080x1920 video to: ${finalOutput}...`);

  return new Promise((resolve, reject) => {
    // 1. Loop video to match audio
    // 2. Crop/scale to 1080x1920 portrait
    // 3. Burn subtitles
    // 4. Encode H.264 / AAC for 100% mobile compatibility
    const ffmpegCmd = [
      'ffmpeg',
      '-y',
      '-stream_loop -1',
      `-i "${bgVideoPath}"`,
      `-i "${audioPath}"`,
      `-filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,subtitles='${escapedSrtPath}'[v]"`,
      `-map "[v]"`,
      '-map 1:a',
      '-c:v libx264',
      '-preset fast',
      '-crf 22',
      '-c:a aac',
      '-b:a 192k',
      '-shortest',
      `"${finalOutput}"`,
    ].join(' ');

    exec(ffmpegCmd, (error, stdout, stderr) => {
      if (error) {
        // Fallback without subtitle filter if libass/filter is not available
        console.warn(`[FFmpeg] Subtitle filter warning. Retrying fallback render... (${error.message})`);
        const fallbackCmd = [
          'ffmpeg',
          '-y',
          '-stream_loop -1',
          `-i "${bgVideoPath}"`,
          `-i "${audioPath}"`,
          `-vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920"`,
          '-map 0:v',
          '-map 1:a',
          '-c:v libx264',
          '-preset fast',
          '-c:a aac',
          '-shortest',
          `"${finalOutput}"`,
        ].join(' ');

        exec(fallbackCmd, (fallbackErr) => {
          if (fallbackErr) {
            console.error('[FFmpeg] Video rendering failed:', fallbackErr.message);
            return reject(fallbackErr);
          }
          console.log(`[FFmpeg] Render complete (Clean): ${finalOutput}`);
          resolve(finalOutput);
        });
        return;
      }

      console.log(`[FFmpeg] Render complete with subtitles: ${finalOutput}`);
      resolve(finalOutput);
    });
  });
}

module.exports = {
  renderShortVideo,
};
