const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Convert VTT to SRT for seamless subtitle burning/muxing
 */
function convertVttToSrt(vttPath, srtPath) {
  if (!fs.existsSync(vttPath)) return null;
  const vttContent = fs.readFileSync(vttPath, 'utf8');
  const srtContent = vttContent
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2')
    .trim();
  fs.writeFileSync(srtPath, srtContent, 'utf8');
  return srtPath;
}

/**
 * Resolve background music (BGM) file path
 */
function resolveBgmPath(bgmName) {
  if (!bgmName || bgmName === 'none') return null;
  const bgmDir = path.join(__dirname, '..', 'assets', 'audio', 'bgm');
  
  // Direct file check
  if (fs.existsSync(bgmName)) return bgmName;

  const candidateNames = [
    `${bgmName}.mp3`,
    `${bgmName}.wav`,
    'cinematic_suspense.mp3',
    'deep_mystery.mp3',
    'stoic_motivation.mp3'
  ];

  for (const name of candidateNames) {
    const full = path.join(bgmDir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/**
 * Render Final 1080x1920 Short with Multi-Scene B-Roll, Subtitles, and BGM Audio
 * @param {string|string[]} bgInput Single video path or array of clip paths
 * @param {string} audioPath Voiceover MP3 path
 * @param {string} subPath Subtitles VTT path
 * @param {string} [outputVideoPath] Destination MP4 path
 * @param {object} [options] Rendering options (bgm, volume, etc.)
 */
async function renderShortVideo(bgInput, audioPath, subPath, outputVideoPath, options = {}) {
  const finalOutput = outputVideoPath || path.join(__dirname, '..', 'assets', `final_short_${Date.now()}.mp4`);
  const srtPath = subPath ? subPath.replace(/\.vtt$/i, '.srt') : null;
  if (subPath && srtPath) {
    convertVttToSrt(subPath, srtPath);
  }

  // Format subtitle path for FFmpeg filter
  const escapedSrtPath = srtPath
    ? srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
    : null;

  // Resolve background music
  const enableBgm = options.enableBgm !== false && config.ENABLE_BGM;
  const bgmName = options.bgm || config.DEFAULT_BGM;
  const bgmPath = enableBgm ? resolveBgmPath(bgmName) : null;
  const bgmVol = (typeof options.bgmVolume === 'number') ? options.bgmVolume : config.BGM_VOLUME;

  console.log(`[FFmpeg] Rendering finalized 1080x1920 video to: ${finalOutput}...`);
  if (bgmPath) console.log(`[FFmpeg BGM] Mixing background music track: ${path.basename(bgmPath)} (Vol: ${bgmVol})`);

  // Normalize video inputs (single vs multi-scene clips)
  const videoClips = Array.isArray(bgInput) ? bgInput.filter(f => f && fs.existsSync(f)) : [bgInput];
  const validClips = videoClips.length > 0 ? videoClips : [bgInput];

  return new Promise((resolve, reject) => {
    let inputArgs = [];
    let filterParts = [];
    let videoStreamLabel = '';
    let audioStreamLabel = '';

    // 1. Process Video Inputs
    if (validClips.length === 1) {
      inputArgs.push('-stream_loop -1', `-i "${validClips[0]}"`);
      videoStreamLabel = '0:v';
    } else {
      validClips.forEach((clip) => {
        inputArgs.push(`-i "${clip}"`);
      });
      // Normalize each clip and concatenate
      validClips.forEach((_, idx) => {
        filterParts.push(`[${idx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setpts=PTS-STARTPTS[c${idx}]`);
      });
      const concatInputs = validClips.map((_, idx) => `[c${idx}]`).join('');
      filterParts.push(`${concatInputs}concat=n=${validClips.length}:v=1:a=0[vconcat]`);
      videoStreamLabel = 'vconcat';
    }

    // 2. Audio Inputs & Mixing
    const voiceInputIdx = validClips.length;
    inputArgs.push(`-i "${audioPath}"`);

    let bgmInputIdx = -1;
    if (bgmPath) {
      bgmInputIdx = validClips.length + 1;
      inputArgs.push('-stream_loop -1', `-i "${bgmPath}"`);
      filterParts.push(`[${voiceInputIdx}:a]volume=1.0[voice]; [${bgmInputIdx}:a]volume=${bgmVol}[bgm]; [voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
      audioStreamLabel = 'aout';
    } else {
      audioStreamLabel = `${voiceInputIdx}:a`;
    }

    // 3. Subtitles & Formatting
    // Primary attempt: Burn styled viral subtitles into video stream
    const styledSubFilter = escapedSrtPath
      ? `subtitles='${escapedSrtPath}':force_style='Fontname=Impact,FontSize=20,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,Outline=2,Shadow=1,Alignment=2,MarginV=360'`
      : null;

    let vFinalFilter = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`;
    if (styledSubFilter) {
      vFinalFilter += `,${styledSubFilter}`;
    }

    if (validClips.length === 1) {
      filterParts.push(`[${videoStreamLabel}]${vFinalFilter}[vfinal]`);
    } else {
      filterParts.push(`[${videoStreamLabel}]${vFinalFilter}[vfinal]`);
    }

    const primaryCmd = [
      'ffmpeg',
      '-y',
      inputArgs.join(' '),
      `-filter_complex "${filterParts.join('; ')}"`,
      '-map "[vfinal]"',
      `-map "${audioStreamLabel.startsWith('[') ? audioStreamLabel : (audioStreamLabel.includes(':') ? audioStreamLabel : `[${audioStreamLabel}]`)}"`,
      '-c:v libx264',
      '-preset fast',
      '-crf 22',
      '-c:a aac',
      '-b:a 192k',
      '-shortest',
      `"${finalOutput}"`,
    ].join(' ');

    exec(primaryCmd, (error) => {
      if (!error) {
        console.log(`[FFmpeg] Render complete with burned subtitles & BGM: ${finalOutput}`);
        return resolve(finalOutput);
      }

      console.warn(`[FFmpeg] Burned subtitle filter not available on current host (${error.message.slice(0, 100)}...). Running resilient fallback with soft-subtitles / BGM...`);

      // Resilient Fallback: Clean video scaling + audio mix + embedded mov_text subtitle stream
      let fbFilters = [];
      let fbVideoLabel = '';
      let fbAudioLabel = '';

      if (validClips.length === 1) {
        fbFilters.push(`[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[vclean]`);
        fbVideoLabel = '[vclean]';
      } else {
        validClips.forEach((_, idx) => {
          fbFilters.push(`[${idx}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,setpts=PTS-STARTPTS[c${idx}]`);
        });
        const concatInputs = validClips.map((_, idx) => `[c${idx}]`).join('');
        fbFilters.push(`${concatInputs}concat=n=${validClips.length}:v=1:a=0[vconcat]`);
        fbVideoLabel = '[vconcat]';
      }

      if (bgmPath) {
        fbFilters.push(`[${voiceInputIdx}:a]volume=1.0[voice]; [${bgmInputIdx}:a]volume=${bgmVol}[bgm]; [voice][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`);
        fbAudioLabel = '[aout]';
      } else {
        fbAudioLabel = `${voiceInputIdx}:a`;
      }

      let subInputArg = '';
      let subMapArg = '';
      if (srtPath && fs.existsSync(srtPath)) {
        const subInputIdx = validClips.length + (bgmPath ? 2 : 1);
        subInputArg = ` -i "${srtPath}"`;
        subMapArg = ` -map ${subInputIdx}:s -c:s mov_text -metadata:s:s:0 language=hin`;
      }

      const fallbackCmd = [
        'ffmpeg',
        '-y',
        inputArgs.join(' ') + subInputArg,
        `-filter_complex "${fbFilters.join('; ')}"`,
        `-map "${fbVideoLabel}"`,
        `-map "${fbAudioLabel}"`,
        subMapArg,
        '-c:v libx264',
        '-preset fast',
        '-c:a aac',
        '-shortest',
        `"${finalOutput}"`,
      ].join(' ');

      exec(fallbackCmd, (fallbackErr) => {
        if (fallbackErr) {
          console.error('[FFmpeg] Video rendering failed completely:', fallbackErr.message);
          return reject(fallbackErr);
        }
        console.log(`[FFmpeg] Render complete (Resilient stream): ${finalOutput}`);
        resolve(finalOutput);
      });
    });
  });
}

module.exports = {
  renderShortVideo,
  convertVttToSrt,
};
