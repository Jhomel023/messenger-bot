const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Kukunin ang Environment Variables mula sa Render Dashboard
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

// 1. WEBHOOK VERIFICATION (Para sa Facebook setup)
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

// 2. RECEIVE MESSAGES FROM FACEBOOK
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(async (entry) => {
      if (!entry.messaging) return;
      const webhookEvent = entry.messaging[0];
      const senderPsid = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const userMessage = webhookEvent.message.text;
        console.log(`📩 Message from ${senderPsid}: "${userMessage}"`);
        await handleMessage(senderPsid, userMessage);
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// 3. COMMAND HANDLER
async function handleMessage(senderPsid, text) {
  const messageText = text.trim();

  // 📸 COMMAND 1: /image <prompt>
  if (messageText.startsWith('/image')) {
    const prompt = messageText.replace('/image', '').trim();
    if (!prompt) {
      return await sendTextMessage(senderPsid, "⚠️ Maglagay ng prompt! Example: /image cute cat");
    }

    await sendTextMessage(senderPsid, "🎨 Generating image, please wait...");
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    return await sendMediaMessage(senderPsid, imageUrl, 'image');
  }

  // 🎵 COMMAND 2: /play <song>
  if (messageText.startsWith('/play') || messageText.startsWith('/music')) {
    const songQuery = messageText.replace(/\/play|\/music/, '').trim();
    if (!songQuery) {
      return await sendTextMessage(senderPsid, "⚠️ Maglagay ng kanta! Example: /play paradise chase atlantic");
    }

    await sendTextMessage(senderPsid, `🎵 Searching audio for "${songQuery}"...`);
    try {
      const deezerRes = await axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(songQuery)}`);
      if (deezerRes.data && deezerRes.data.data.length > 0) {
        const track = deezerRes.data.data[0];
        await sendTextMessage(senderPsid, `🎶 Playing preview: ${track.title} - ${track.artist.name}`);
        return await sendMediaMessage(senderPsid, track.preview, 'audio');
      } else {
        return await sendTextMessage(senderPsid, `❌ Song "${songQuery}" not found.`);
      }
    } catch (err) {
      return await sendTextMessage(senderPsid, "❌ Error fetching music.");
    }
  }

  // ✂️ COMMAND 3: /removebg
  if (messageText.startsWith('/removebg')) {
    return await sendTextMessage(senderPsid, "💡 Mag-reply sa isang picture gamit ang prompt o mag-send ng image URL!");
  }

  // DEFAULT HELP
  return await sendTextMessage(senderPsid, `🤖 Bot Commands:\n- /image <prompt>\n- /play <title>`);
}

// 4. SEND TEXT MESSAGE API
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

// 5. SEND MEDIA (IMAGE / AUDIO) API
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
