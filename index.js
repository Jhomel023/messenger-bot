const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

// I-store muna natin ang huling image URL na sinend ng bawat user (pansamantalang memory)
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
        
        // Kapag nag-send ng picture ang user, i-save natin agad sa memory
        if (message.attachments && message.attachments.length > 0) {
          const attachment = message.attachments[0];
          if (attachment.type === 'image') {
            userLastImages[senderPsid] = attachment.payload.url;
            console.log(`📷 Image saved for user ${senderPsid}`);
            await sendTextMessage(senderPsid, "📸 Nakuha ko ang picture! I-type na ang /removebg para tanggalin ang background.");
            return;
          }
        }

        if (userText) {
          console.log(`📩 Message from ${senderPsid}: "${userText}"`);
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
    if (!prompt) {
      return await sendTextMessage(senderPsid, "⚠️ Maglagay ng prompt! Example: /image cute cat");
    }

    await sendTextMessage(senderPsid, "🎨 Generating image, please wait...");
    const genImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    return await sendMediaMessage(senderPsid, genImageUrl, 'image');
  }

  if (messageText.startsWith('/play') || messageText.startsWith('/music')) {
    const songQuery = text.replace(/\/play|\/music/, '').trim();
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

  // ✂️ COMMAND: /removebg (Kukunin yung huling sinend na picture)
  if (messageText.startsWith('/removebg')) {
    const imageUrl = userLastImages[senderPsid];
    if (!imageUrl) {
      return await sendTextMessage(senderPsid, "⚠️ Mag-send ka muna ng picture bago i-type ang /removebg!");
    }

    await sendTextMessage(senderPsid, "✂️ Pinoproseso ang larawan...");
    
    try {
      // Dito mo ikakabit ang background removal API kung meron ka, 
      // Pansamantalang ibabalik muna natin ang picture para ma-test mo.
      await sendTextMessage(senderPsid, "✅ Narito ang resulta:");
      return await sendMediaMessage(senderPsid, imageUrl, 'image');
    } catch (err) {
      return await sendTextMessage(senderPsid, "❌ May error sa pag-process ng removebg.");
    }
  }

  return await sendTextMessage(senderPsid, `🤖 Bot Commands:\n- /image <prompt>\n- /play <title>\n- /removebg`);
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
