const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Generate Voiceover & Subtitles using Edge-TTS with natural rate & pitch
 * @param {string} text Spoken text
 * @param {string} voice Name of the Edge-TTS voice
 * @param {string} outputAudioPath
 * @param {string} outputSubPath
 */
async function generateVoiceover(text, voice = config.DEFAULT_VOICE, outputAudioPath, outputSubPath) {
  const audioPath = outputAudioPath || path.join(__dirname, '..', 'assets', `audio_${Date.now()}.mp3`);
  const subPath = outputSubPath || path.join(__dirname, '..', 'assets', `sub_${Date.now()}.vtt`);

  const assetsDir = path.dirname(audioPath);
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const tempTextFile = path.join(assetsDir, `text_${Date.now()}.txt`);
  fs.writeFileSync(tempTextFile, text, 'utf8');

  console.log(`[Edge-TTS] Synthesizing high-cadence voiceover with: "${voice}"...`);

  return new Promise((resolve, reject) => {
    // Rate +5% keeps viewers engaged without dragging
    const cmd = `python3 -m edge_tts --voice "${voice}" --rate="+5%" --file "${tempTextFile}" --write-media "${audioPath}" --write-subtitles "${subPath}"`;
    exec(cmd, (error, stdout, stderr) => {
      if (fs.existsSync(tempTextFile)) fs.unlinkSync(tempTextFile);

      if (error) {
        console.error('[Edge-TTS] Voice synthesis error:', stderr || error.message);
        return reject(error);
      }

      console.log(`[Edge-TTS] Voiceover ready: ${audioPath}`);
      console.log(`[Edge-TTS] Subtitle timestamps ready: ${subPath}`);

      resolve({
        audioPath,
        subPath,
      });
    });
  });
}

module.exports = {
  generateVoiceover,
};
