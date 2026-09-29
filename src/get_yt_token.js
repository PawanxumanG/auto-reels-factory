const { google } = require('googleapis');
const http = require('http');
const url = require('url');

const CLIENT_ID = '904178567118-0a5ig6jslbttfme9njvn6ijdn2ontllm.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:8080';

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const scopes = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes,
  prompt: 'consent',
});

console.log('\n============================================================');
console.log('🔗 CLICK THIS LINK TO CONNECT YOUR YOUTUBE CHANNEL:');
console.log('============================================================\n');
console.log(authUrl);
console.log('\n============================================================');
console.log('⏳ Local listener active on http://localhost:8080 ...');
console.log('============================================================\n');

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = url.parse(req.url, true);
    const code = parsedUrl.query.code;
    if (code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <div style="font-family:sans-serif; text-align:center; padding:50px;">
          <h1 style="color:#10b981;">✅ YouTube Channel Connected!</h1>
          <p style="font-size:18px;">Your upload authorization is complete. You can close this tab now.</p>
        </div>
      `);

      const { tokens } = await oauth2Client.getToken(code);
      console.log('\n============================================================');
      console.log('🎉 REFRESH_TOKEN:');
      console.log(tokens.refresh_token);
      console.log('============================================================\n');

      // Update .env file automatically
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(__dirname, '..', '.env');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        envContent = envContent.replace(/YOUTUBE_CLIENT_ID=.*/, `YOUTUBE_CLIENT_ID=${CLIENT_ID}`);
        envContent = envContent.replace(/YOUTUBE_CLIENT_SECRET=.*/, `YOUTUBE_CLIENT_SECRET=${CLIENT_SECRET}`);
        envContent = envContent.replace(/YOUTUBE_REFRESH_TOKEN=.*/, `YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log('✅ .env updated automatically with your YouTube credentials!');
      }

      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 1000);
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Error retrieving token: ' + err.message);
    console.error('Error exchanging code:', err.message);
  }
});

server.listen(8080);
