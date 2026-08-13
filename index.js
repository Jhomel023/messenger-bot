const login = require('fca-unofficial');
const fs = require('fs');
const axios = require('axios');

// Read appstate.json
const appState = JSON.parse(fs.readFileSync('appstate.json', 'utf8'));

login({ appState }, (err, api) => {
  if (err) return console.error("Login Error:", err);

  console.log("Bot successfully logged in!");

  // Listen for messages in DMs and Group Chats
  api.listenMqtt(async (err, event) => {
    if (err) return console.error(err);

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
            const audioUrl = track.preview;

            api.sendMessage(`🎶 Playing preview: ${track.title} - ${track.artist.name}`, threadID);

            return downloadAndSendMedia(api, audioUrl, threadID, "mp3", event.messageID);
          } else {
            return api.sendMessage(`❌ Song "${songQuery}" not found. Try another title!`, threadID, event.messageID);
          }
        } catch (err) {
          console.error("Audio error:", err.message);
          return api.sendMessage("❌ Failed to fetch audio record. Please try again.", threadID, event.messageID);
        }
      }
    }
  });
});

// Helper function to download file and send as stream attachment
async function downloadAndSendMedia(api, url, threadID, extension, replyToID) {
  const filePath = `./temp_${Date.now()}.${extension}`;
  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream'
    });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    writer.on('finish', () => {
      const msg = {
        attachment: fs.createReadStream(filePath)
      };
      api.sendMessage(msg, threadID, () => {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // Clean up temp file
      }, replyToID);
    });
  } catch (err) {
    console.error("Download media error:", err.message);
    api.sendMessage("❌ Error processing media attachment.", threadID, replyToID);
  }
}
