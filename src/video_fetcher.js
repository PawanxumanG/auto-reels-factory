const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Clean search query for Pexels search
 */
function sanitizeQuery(query) {
  if (!query || typeof query !== 'string') return 'cinematic moody vertical';
  return query.replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fetch and download a single vertical 1080x1920 HD video from Pexels
 * @param {string} query
 * @param {string} [outputPath]
 */
async function fetchBackgroundVideo(query = 'dark moody nature', outputPath) {
  const videoPath = outputPath || path.join(__dirname, '..', 'assets', `bg_${Date.now()}_${Math.floor(Math.random() * 1000)}.mp4`);
  const cleanQuery = sanitizeQuery(query);
  console.log(`[Pexels API] Searching HD vertical footage for query: "${cleanQuery}"...`);

  try {
    let res = await axios.get('https://api.pexels.com/videos/search', {
      params: {
        query: cleanQuery,
        orientation: 'portrait',
        per_page: 15,
      },
      headers: {
        Authorization: config.PEXELS_API_KEY,
      },
      timeout: 12000,
    });

    let videos = res.data.videos || [];
    if (videos.length === 0) {
      console.warn(`[Pexels API] Zero results for "${cleanQuery}", trying fallback "cinematic moody vertical"...`);
      res = await axios.get('https://api.pexels.com/videos/search', {
        params: {
          query: 'cinematic moody vertical',
          orientation: 'portrait',
          per_page: 10,
        },
        headers: { Authorization: config.PEXELS_API_KEY },
        timeout: 10000,
      });
      videos = res.data.videos || [];
    }

    if (videos.length === 0) {
      throw new Error(`Could not find any suitable background videos for "${cleanQuery}" on Pexels.`);
    }

    // Filter portrait videos with duration >= 4s
    const filteredVideos = videos.filter((v) => (v.duration || 0) >= 4);
    const candidateList = filteredVideos.length > 0 ? filteredVideos : videos;
    const selected = candidateList[Math.floor(Math.random() * Math.min(candidateList.length, 5))];

    // Find best portrait HD 1080x1920 or 720x1280 stream
    let bestFile = selected.video_files.find((f) => f.width === 1080 && f.height === 1920);
    if (!bestFile) {
      bestFile = selected.video_files.find((f) => f.height > f.width && f.quality === 'hd');
    }
    if (!bestFile) {
      bestFile = selected.video_files.find((f) => f.height > f.width) || selected.video_files[0];
    }

    const assetsDir = path.dirname(videoPath);
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    console.log(`[Pexels API] Downloading clip (${bestFile.width}x${bestFile.height}, ${selected.duration}s)...`);

    const writer = fs.createWriteStream(videoPath);
    const downloadRes = await axios({
      method: 'GET',
      url: bestFile.link,
      responseType: 'stream',
      timeout: 60000,
    });

    downloadRes.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`[Pexels API] Video clip ready: ${videoPath}`);
        resolve({ videoPath, width: bestFile.width, height: bestFile.height, duration: selected.duration });
      });
      writer.on('error', reject);
      downloadRes.data.on('error', reject);
    });
  } catch (err) {
    console.error(`[Pexels API] Error fetching video for "${cleanQuery}":`, err.message);
    throw err;
  }
}

/**
 * Fetch multiple dynamic b-roll video clips corresponding to each scene in the script
 * @param {string[]} sceneQueries Array of scene visual queries
 * @param {string} outputDir Directory to save temporary clips
 * @param {number} [maxScenes=4]
 * @returns {Promise<Array<{videoPath: string, duration: number, query: string}>>}
 */
async function fetchMultiSceneVideos(sceneQueries = [], outputDir, maxScenes = 4) {
  const dir = outputDir || path.join(__dirname, '..', 'assets');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const queries = (Array.isArray(sceneQueries) && sceneQueries.length > 0)
    ? sceneQueries.slice(0, maxScenes)
    : ['cinematic dark landscape', 'thinking portrait dramatic', 'city neon rain night'];

  console.log(`[Pexels API] Fetching dynamic multi-scene b-roll for ${queries.length} scenes...`);

  const results = [];
  const timestamp = Date.now();

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const targetFile = path.join(dir, `scene_${timestamp}_${i + 1}.mp4`);
    try {
      console.log(`[Pexels B-Roll] Downloading scene #${i + 1}/${queries.length}: "${q}"...`);
      const clip = await fetchBackgroundVideo(q, targetFile);
      results.push({
        query: q,
        videoPath: clip.videoPath,
        duration: clip.duration,
      });
    } catch (clipErr) {
      console.warn(`[Pexels B-Roll] Warning on scene #${i + 1}: ${clipErr.message}`);
      // If we have at least one previous video, duplicate reference
      if (results.length > 0) {
        results.push(results[results.length - 1]);
      }
    }
  }

  // If completely empty, fetch one guaranteed fallback
  if (results.length === 0) {
    const fallbackPath = path.join(dir, `scene_${timestamp}_fallback.mp4`);
    const single = await fetchBackgroundVideo('cinematic vertical nature', fallbackPath);
    results.push({
      query: 'cinematic vertical nature',
      videoPath: single.videoPath,
      duration: single.duration,
    });
  }

  console.log(`[Pexels B-Roll] Successfully prepared ${results.length} multi-scene clips!`);
  return results;
}

module.exports = {
  fetchBackgroundVideo,
  fetchMultiSceneVideos,
};
