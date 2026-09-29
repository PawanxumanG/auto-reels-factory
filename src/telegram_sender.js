const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const config = require('./config');

/**
 * Send rendered Short video directly to Telegram user/channel
 * @param {string} videoFilePath 
 * @param {object} scriptData 
 * @param {string} [youtubeUrl] 
 */
async function sendToTelegram(videoFilePath, scriptData, youtubeUrl = null) {
  if (!config.TELEGRAM_BOT_TOKEN || !config.TELEGRAM_CHAT_ID) {
    console.log('[Telegram] Skipping delivery (credentials not set).');
    return;
  }

  console.log(`[Telegram] Uploading rendered Short to Telegram chat (${config.TELEGRAM_CHAT_ID})...`);

  const cleanTitle = (scriptData.title || 'Auto Short').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const cleanHook = (scriptData.hook || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const caption =
    `🎬 <b>New Auto Short Ready!</b>\n\n` +
    `📌 <b>Title:</b> ${cleanTitle}\n\n` +
    `📝 <b>Hook:</b> <i>"${cleanHook}"</i>\n\n` +
    (youtubeUrl ? `🔗 <b>Live YouTube Link:</b> <a href="${youtubeUrl}">Watch on YouTube Shorts</a>\n\n` : '') +
    `🏷️ <b>Tags:</b> ${scriptData.tags ? scriptData.tags.join(' ') : '#shorts #viral'}\n\n` +
    `⚡ <i>Rendered via Groq & 24/7 Cloud Factory</i>`;

  try {
    const formData = new FormData();
    formData.append('chat_id', config.TELEGRAM_CHAT_ID);
    formData.append('video', fs.createReadStream(videoFilePath));
    formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');
    formData.append('supports_streaming', 'true');

    const res = await axios.post(
      `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendVideo`,
      formData,
      {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 120000,
      }
    );

    console.log(`[Telegram] Successfully sent video to chat ${config.TELEGRAM_CHAT_ID}!`);
    return res.data;
  } catch (err) {
    console.error('[Telegram] Failed to send video:', err.response?.data || err.message);
  }
}

module.exports = {
  sendToTelegram,
};
