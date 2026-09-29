const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Fetch and download high-quality vertical 1080x1920 HD video from Pexels
 * @param {string} query
 * @param {string} outputPath
 */
async function fetchBackgroundVideo(query = 'dark moody nature', outputPath) {
  const videoPath = outputPath || path.join(__dirname, '..', 'assets', `bg_${Date.now()}.mp4`);
  console.log(`[Pexels API] Searching HD vertical footage for query: "${query}"...`);

  const cleanQuery = query.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();

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
      console.warn(`[Pexels API] Zero results for "${cleanQuery}", trying fallback "cinematic moody"...`);
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
      throw new Error('Could not find any suitable background videos on Pexels.');
    }

    // Filter portrait videos with duration >= 10s
    const filteredVideos = videos.filter((v) => (v.duration || 0) >= 6);
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

    console.log(`[Pexels API] Downloading cinematic clip (${bestFile.width}x${bestFile.height}, ${selected.duration}s)...`);

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
        console.log(`[Pexels API] Background video downloaded: ${videoPath}`);
        resolve({ videoPath, width: bestFile.width, height: bestFile.height, duration: selected.duration });
      });
      writer.on('error', reject);
      downloadRes.data.on('error', reject);
    });
  } catch (err) {
    console.error('[Pexels API] Error fetching video:', err.message);
    throw err;
  }
}

module.exports = {
  fetchBackgroundVideo,
};
