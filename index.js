const login = require('fca-project-origo');
const fs = require('fs');
const axios = require('axios');

let appState;
try {
  appState = JSON.parse(fs.readFileSync('appstate.json', 'utf8'));
} catch (err) {
  console.error("Error reading appstate.json file:", err.message);
}

if (appState) {
  login({ appState }, { listenEvents: true, selfListen: false }, (err, api) => {
    if (err) return console.error("Facebook Login Error:", err);

    console.log("🚀 Bot successfully logged in on your PC and listening for messages!");

    api.setOptions({ listenEvents: true, selfListen: false });

    api.listenMqtt(async (err, event) => {
      if (err) return console.error("Listen Error:", err);

      if (event.type === "message" || event.type === "message_reply") {
        const messageText = event.body ? event.body.trim() : "";
        const threadID = event.threadID;

        // ✂️ COMMAND 1: /removebg
        if (messageText.startsWith('/removebg') || messageText.startsWith('/nobg')) {
          let targetImageUrl = null;

          if (event.attachments && event.attachments[0] && event.attachments[0].type === 'photo') {
            targetImageUrl = event.attachments[0].url;
          } else if (event.messageReply && event.messageReply.attachments && event.messageReply.attachments[0].type === 'photo') {
            targetImageUrl = event.messageReply.attachments[0].url;
          }

          if (!targetImageUrl) {
            return api.sendMessage("Please send or reply to an image with /removebg !", threadID, event.messageID);
          }

          api.sendMessage("✂️ Removing background, please wait...", threadID);
          const processedBgUrl = `https://image.pollinations.ai/prompt/remove%20background%20isolated%20on%20transparent?image=${encodeURIComponent(targetImageUrl)}`;
          return downloadAndSendMedia(api, processedBgUrl, threadID, "png", event.messageID);
        }

        // 📸 COMMAND 2: /image <prompt>
        if (messageText.startsWith('/image')) {
          const prompt = messageText.replace('/image', '').trim();
          if (!prompt) {
            return api.sendMessage("Please provide a prompt! Example: /image cute cat", threadID, event.messageID);
          }

          api.sendMessage("🎨 Generating image, please wait...", threadID);
          const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
          return downloadAndSendMedia(api, imageUrl, threadID, "jpg", event.messageID);
        }

        // 🎵 COMMAND 3: /play or /music <title>
        if (messageText.startsWith('/play') || messageText.startsWith('/music')) {
          const songQuery = messageText.replace(/\/play|\/music/, '').trim();
          if (!songQuery) {
            return api.sendMessage("Please provide a song title! Example: /play paradise by chase atlantic", threadID, event.messageID);
          }

          api.sendMessage(`🎵 Searching audio for "${songQuery}"...`, threadID);
          try {
            const deezerRes = await axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(songQuery)}`);
            if (deezerRes.data && deezerRes.data.data.length > 0) {
              const track = deezerRes.data.data[0];
              api.sendMessage(`🎶 Playing preview: ${track.title} - ${track.artist.name}`, threadID);
              return downloadAndSendMedia(api, track.preview, threadID, "mp3", event.messageID);
            } else {
              return api.sendMessage(`❌ Song "${songQuery}" not found.`, threadID, event.messageID);
            }
          } catch (err) {
            return api.sendMessage("❌ Failed to fetch audio record.", threadID, event.messageID);
          }
        }
      }
    });
  });
}

async function downloadAndSendMedia(api, url, threadID, extension, replyToID) {
  const filePath = `./temp_${Date.now()}.${extension}`;
  try {
    const response = await axios({ url, method: 'GET', responseType: 'stream' });
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on('finish', () => {
      api.sendMessage({ attachment: fs.createReadStream(filePath) }, threadID, () => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }, replyToID);
    });
  } catch (err) {
    api.sendMessage("❌ Error processing media attachment.", threadID, replyToID);
  }
}
