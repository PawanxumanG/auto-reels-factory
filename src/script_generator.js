const axios = require('axios');
const config = require('./config');

const NICHE_CONFIGS = {
  psychology: {
    name: 'Human Psychology & Dark Secrets',
    topics: [
      '3 Dark psychological tricks people use to manipulate conversations',
      'The psychological reason why people secretly get jealous of you',
      'How to read anyone body language in less than 5 seconds',
      'Why high-value people speak less and observe more',
      'The subconscious reason why you procrastinate on your biggest dreams',
      '3 Psychological signs someone is lying straight to your face',
    ],
    visualPool: [
      'man walking rain silhouette dark',
      'thinking man dark moody portrait',
      'chess game dramatic light',
      'hourglass sand falling dark',
      'mysterious shadow walking city night',
      'neon rain reflections city street',
    ],
    defaultTags: ['#shorts', '#psychology', '#humanbehavior', '#mindset', '#psychologicalfacts', '#darkpsychology', '#viral', '#trending'],
  },
  facts: {
    name: 'Terrifying Facts & World Mysteries',
    topics: [
      '3 Terrifying deep ocean mysteries that science cannot explain',
      'Space anomalies that violate the known laws of physics',
      'Unsolved ancient civilizations that vanished without a trace',
      'Crazy Earth facts that sound 100% fake but are scientifically true',
      'What happens to your body during deep space travel',
    ],
    visualPool: [
      'galaxy stars nebula cinematic',
      'deep sea glowing creature underwater',
      'aurora borealis night sky dramatic',
      'volcano magma eruption night',
      'foggy ancient temple ruins',
      'ocean giant waves storm',
    ],
    defaultTags: ['#shorts', '#facts', '#mysteries', '#ocean', '#space', '#mindblown', '#didyouknow', '#sciencefacts'],
  },
  cricket: {
    name: 'Cricket Shocking Records & Legends',
    topics: [
      '3 Unbreakable cricket records that will stand forever',
      'The real reason MS Dhoni chose jersey number 7',
      'The most insane last-over finishes in cricket history',
      'Fastest bowlers in cricket history who terrorized batsmen',
      'Virat Kohli most clutch chases that shocked the world',
    ],
    visualPool: [
      'cricket stadium lights night',
      'cricket batsman training stadium',
      'stadium crowd cheering night',
      'athlete running rain slow motion',
      'sports stadium floodlights cinematic',
    ],
    defaultTags: ['#shorts', '#cricket', '#cricketrecords', '#msdhoni', '#viratkohli', '#ipl', '#cricketlover', '#sports'],
  },
  motivation: {
    name: 'Stoic Motivation & The 1% Rule',
    topics: [
      'The brutal truth about discipline that high achievers know',
      'The 1% rule that will transform your life in 6 months',
      'Stoic secrets to remain calm in absolute chaos',
      'Why you must disappear for 6 months to change your entire life',
      'How to build iron-clad mental toughness when you feel like quitting',
    ],
    visualPool: [
      'man standing mountain summit dramatic storm',
      'luxury sports car city night lights',
      'boxer shadowboxing dark gym',
      'rain on skyscraper window dark office',
      'cinematic lion walking dark savanna',
    ],
    defaultTags: ['#shorts', '#motivation', '#discipline', '#stoicism', '#success', '#grind', '#mindset', '#quotes'],
  },
};

/**
 * Generate a viral, high-retention Short script using Groq AI
 * @param {string} niche
 * @param {string} language
 * @param {string} [customTopic]
 */
async function generateScript(niche = config.DEFAULT_NICHE, language = config.VIDEO_LANGUAGE, customTopic = null) {
  const nicheData = NICHE_CONFIGS[niche] || NICHE_CONFIGS.psychology;
  const topic = customTopic || nicheData.topics[Math.floor(Math.random() * nicheData.topics.length)];
  const visualKeyword = nicheData.visualPool[Math.floor(Math.random() * nicheData.visualPool.length)];

  console.log(`[Groq AI] Crafting viral script for: "${topic}" (${language.toUpperCase()})...`);

  const systemPrompt = `You are an elite YouTube Shorts & Instagram Reels creator with over 100 Million views.
Your mission is to write an addictive, fast-paced, high-retention video script (30-40 seconds spoken length).

VIRAL SCRIPT ARCHITECTURE:
1. HOOK (0-3s): A shocking question, contradiction, or pattern interrupt that forces viewers to stop scrolling.
2. BODY (3-30s): 3 rapid-fire, high-value insights/facts delivered with punchy sentences.
3. CTA (30-35s): A smooth call-to-action asking viewers to follow & comment.

OUTPUT STRICTLY VALID JSON:
{
  "title": "Viral Click-Worthy Title with Emojis & #shorts (Max 70 chars)",
  "hook": "The opening 3-second hook sentence",
  "points": [
    "Point 1 (Punchy & direct)",
    "Point 2 (Insightful & fast-paced)",
    "Point 3 (Climax or most shocking detail)"
  ],
  "cta": "Engaging closing sentence",
  "spoken_text": "The complete natural voiceover script with natural punctuation and zero stage directions.",
  "pexels_query": "${visualKeyword}",
  "tags": ${JSON.stringify(nicheData.defaultTags)},
  "description": "2-sentence viral summary + timestamps + SEO keywords + hashtags"
}

LANGUAGE REQUIREMENT:
- If language is 'hindi': Write 'spoken_text', 'hook', 'points', and 'cta' in natural, conversational spoken Hindi (or crisp Devanagari Hindi that sounds energetic and engaging when voiced).
- If language is 'english': Write in crisp, dramatic American English.`;

  const userPrompt = `Create a viral script for the topic: "${topic}".
Ensure spoken_text is around 75 to 95 words (exactly 30-35 seconds read time).
Pexels visual search keyword: "${visualKeyword}".`;

  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: config.GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${config.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const parsed = JSON.parse(res.data.choices[0].message.content);
    if (!parsed.pexels_query) parsed.pexels_query = visualKeyword;
    if (!parsed.tags || parsed.tags.length === 0) parsed.tags = nicheData.defaultTags;

    console.log(`[Groq AI] Successfully generated: "${parsed.title}"`);
    return parsed;
  } catch (err) {
    console.error('[Groq AI] Generation error:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = {
  NICHE_CONFIGS,
  generateScript,
};
