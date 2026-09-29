const fs = require('fs');
const { google } = require('googleapis');
const config = require('./config');

/**
 * Upload Video to YouTube Shorts via YouTube Data API v3 with full SEO metadata
 * @param {string} videoFilePath
 * @param {object} scriptData
 */
async function uploadToYouTube(videoFilePath, scriptData, uploadOptions = {}) {
  if (!config.YOUTUBE_CLIENT_ID || !config.YOUTUBE_CLIENT_SECRET || !config.YOUTUBE_REFRESH_TOKEN) {
    console.log('[YouTube] OAuth credentials missing. Skipping YouTube upload.');
    return null;
  }

  console.log(`[YouTube] Uploading Short: "${scriptData.title}" to YouTube...`);

  try {
    const oauth2Client = new google.auth.OAuth2(
      config.YOUTUBE_CLIENT_ID,
      config.YOUTUBE_CLIENT_SECRET,
      'http://localhost:8080'
    );

    oauth2Client.setCredentials({
      refresh_token: config.YOUTUBE_REFRESH_TOKEN,
    });

    const youtube = google.youtube({
      version: 'v3',
      auth: oauth2Client,
    });

    const rawTags = (scriptData.tags || []).concat(
      uploadOptions.customTags ? uploadOptions.customTags.split(/[\s,]+/) : []
    );
    const cleanTags = rawTags
      .map((t) => t.replace(/^#/, '').trim())
      .filter(Boolean);
    
    // Ensure essential viral tags are present
    const essentialTags = ['shorts', 'youtubeshorts', 'viral', 'trending', 'shortsfeed', 'reels'];
    essentialTags.forEach(tag => {
      if (!cleanTags.includes(tag)) cleanTags.push(tag);
    });

    const videoTitle = scriptData.title.length > 85 ? scriptData.title.slice(0, 85) : scriptData.title;
    const finalTitle = videoTitle.includes('#shorts') ? videoTitle : `${videoTitle} #shorts`;

    // Map Category based on niche
    let categoryId = '27'; // Education / Knowledge (default)
    if (scriptData.niche === 'cricket') categoryId = '17'; // Sports
    if (scriptData.niche === 'motivation') categoryId = '22'; // People & Blogs

    const description = [
      `🔥 ${scriptData.hook || scriptData.title}`,
      ``,
      `✨ ${scriptData.description || 'Mind-blowing insights and secrets you need to know today.'}`,
      ``,
      `📌 Key Highlights:`,
      ...(scriptData.points && scriptData.points.length > 0
        ? scriptData.points.map((p, idx) => `⏱️ 0:0${(idx + 1) * 8} - ${p}`)
        : ['⏱️ 0:00 - The Hook', '⏱️ 0:10 - The Core Secret', '⏱️ 0:25 - The Shocking Truth']),
      ``,
      `👇 ${uploadOptions.pinnedComment || 'Which fact surprised you the most? Drop your thoughts in the comments!'}`,
      ``,
      `🔔 Subscribe for daily mind-bending insights, psychological facts & secrets!`,
      ``,
      `=============================`,
      `#shorts #youtubeshorts #viral #trending #shortsfeed #facts #psychology #knowledge #reels #mindset`,
    ].join('\n');

    const privacy = uploadOptions.privacyStatus || 'public';

    const res = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: finalTitle,
          description,
          tags: cleanTags,
          categoryId,
          defaultLanguage: 'hi',
        },
        status: {
          privacyStatus: privacy,
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fs.createReadStream(videoFilePath),
      },
    });

    const videoId = res.data.id;
    const videoUrl = `https://youtube.com/shorts/${videoId}`;
    console.log(`[YouTube] 🚀 Upload Complete! Live URL: ${videoUrl}`);
    return {
      videoId,
      videoUrl,
    };
  } catch (err) {
    console.error('[YouTube] Upload error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = {
  uploadToYouTube,
};
