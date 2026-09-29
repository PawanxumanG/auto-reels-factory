require('dotenv').config();

module.exports = {
  GROQ_API_KEY: process.env.GROQ_API_KEY || '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',
  PEXELS_API_KEY: process.env.PEXELS_API_KEY || 'nVtSDkalia2pFPxCDZrG8Xb2SxBvxq4NOd8TuwkFyUDwXC8kx3JAze2W',
  FIREBASE_DB_URL: process.env.FIREBASE_DB_URL || 'https://shorts-factory-6e290-default-rtdb.firebaseio.com',
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8730987422:AAGZRo5MoD28TrCkQzRUbxkE7Wou-lkxuhA',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '6817104054',
  
  DEFAULT_NICHE: process.env.DEFAULT_NICHE || 'psychology',
  DEFAULT_VOICE: process.env.DEFAULT_VOICE || 'hi-IN-MadhurNeural', // Alternatives: hi-IN-SwaraNeural, en-US-ChristopherNeural
  VIDEO_LANGUAGE: process.env.VIDEO_LANGUAGE || 'hindi', // 'hindi' or 'english'

  // YouTube OAuth
  YOUTUBE_CLIENT_ID: process.env.YOUTUBE_CLIENT_ID || '',
  YOUTUBE_CLIENT_SECRET: process.env.YOUTUBE_CLIENT_SECRET || '',
  YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN || '',

  // Groq Model
  GROQ_MODEL: 'openai/gpt-oss-120b', // Fast & high quality
};
