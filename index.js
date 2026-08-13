const express = require('express');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const REMOVE_BG_API_KEY = process.env.REMOVE_BG_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

const userLastImages = {};

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook Verified successfully!');
      return res.status(200).send(challenge);
    } else {
      return res.sendStatus(403);
    }
  }
  res.send('Messenger Bot Server is Running!');
});

app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(async (entry) => {
      if (!entry.messaging) return;
      const webhookEvent = entry.messaging[0];
      const senderPsid = webhookEvent.sender.id;

      if (webhookEvent.message) {
        const message = webhookEvent.message;
        const userText = message.text ? message.text.trim() : '';
        const messageLower = userText.toLowerCase();

        if (message.attachments && message.attachments.length > 0) {
          const attachment = message.attachments[0];
          if (attachment.type === 'image' && attachment.payload && attachment.payload.url) {
            userLastImages[senderPsid] = attachment.payload.url;
            await sendTextMessage(senderPsid, "Image received! Type /removebg to remove background.");
            return;
          }
        }

        if (messageLower.startsWith('/removebg')) {
          const imageUrl = userLastImages[senderPsid];
          if (!imageUrl) return await sendTextMessage(senderPsid, "Please send an image first!");
          if (!REMOVE_BG_API_KEY) return await sendTextMessage(senderPsid, "Error: REMOVE_BG_API_KEY is missing.");

          await sendTextMessage(senderPsid, "Removing background, please wait...");
          try {
            const apiRes = await axios.post(
              'https://api.remove.bg/v1.0/removebg',
              { image_url: imageUrl, size: 'auto' },
              { headers: { 'X-Api-Key': REMOVE_BG_API_KEY }, responseType: 'arraybuffer' }
            );

            const uploadForm = new FormData();
            uploadForm.append('reqtype', 'fileupload');
            uploadForm.append('fileToUpload', Buffer.from(apiRes.data), { filename: 'no-bg.png', contentType: 'image/png' });

            const uploadRes = await axios.post('https://catbox.moe/user/api.php', uploadForm, { headers: uploadForm.getHeaders() });
            const transparentImageUrl = uploadRes.data.trim();

            if (transparentImageUrl.startsWith('http')) {
              await sendTextMessage(senderPsid, "Here is your background-removed image:");
              return await sendMediaMessage(senderPsid, transparentImageUrl, 'image');
            } else {
              throw new Error("Upload failed");
            }
          } catch (err) {
            return await sendTextMessage(senderPsid, "Failed to remove background.");
          }
        }

        if (userText) {
          await handleMessage(senderPsid, userText);
        }
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

async function handleMessage(senderPsid, text) {
  const messageText = text.toLowerCase();

  if (messageText.startsWith('/image')) {
    const prompt = text.replace('/image', '').trim();
    if (!prompt) return await sendTextMessage(senderPsid, "Please provide a prompt! Example: /image cute cat");
    await sendTextMessage(senderPsid, "Generating image...");
    const genImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    return await sendMediaMessage(senderPsid, genImageUrl, 'image');
  }

  if (messageText.startsWith('/play') || messageText.startsWith('/music')) {
    const songQuery = text.replace(/\/play|\/music/, '').trim();
    if (!songQuery) return await sendTextMessage(senderPsid, "Please provide a song title!");
    await sendTextMessage(senderPsid, `Searching audio for "${songQuery}"...`);
    try {
      const deezerRes = await axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(songQuery)}`);
      if (deezerRes.data && deezerRes.data.data.length > 0) {
        const track = deezerRes.data.data[0];
        await sendTextMessage(senderPsid, `Playing preview: ${track.title} - ${track.artist.name}`);
        return await sendMediaMessage(senderPsid, track.preview, 'audio');
      } else {
        return await sendTextMessage(senderPsid, `❌ Song not found.`);
      }
    } catch (err) {
      return await sendTextMessage(senderPsid, "Error fetching music.");
    }
  }

  // --- GEMINI AI CHAT (USING gemini-2.0-flash) ---
  try {
    const geminiRes = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [
          {
            parts: [
              { text: `Please answer the following question in English only: ${text}` }
            ]
          }
        ]
      }
    );

    const aiReply = geminiRes.data.candidates[0].content.parts[0].text || "I couldn't generate a response.";
    return await sendTextMessage(senderPsid, aiReply);
  } catch (err) {
    console.error('Gemini Error:', err.response ? err.response.data : err.message);
    return await sendTextMessage(senderPsid, "An error occurred with the AI. Please try again later.");
  }
}

async function sendTextMessage(senderPsid, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderPsid },
        message: { text: text }
      }
    );
  } catch (err) {
    console.error('❌ Error sending text:', err.response ? err.response.data : err.message);
  }
}

async function sendMediaMessage(senderPsid, url, type) {
  try {
    await axios.post(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: senderPsid },
        message: {
          attachment: {
            type: type,
            payload: { url: url, is_reusable: true }
          }
        }
      }
    );
  } catch (err) {
    console.error('❌ Error sending media:', err.response ? err.response.data : err.message);
  }
}

app.listen(PORT, () => console.log(`🚀 Webhook server running on port ${PORT}`));
