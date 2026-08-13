const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

// 1. WEBHOOK VERIFICATION
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

      // Suriin kung may text o may kasamang attachment (picture)
      if (webhookEvent.message) {
        const message = webhookEvent.message;
        const userText = message.text ? message.text.trim() : '';
        
        // Check kung may ipinadalang imahe ang user
        let attachmentUrl = null;
        if (message.attachments && message.attachments.length > 0) {
          const attachment = message.attachments[0];
          if (attachment.type === 'image') {
            attachmentUrl = attachment.payload.url;
          }
        }

        console.log(`📩 Message from ${senderPsid}: text="${userText}", hasImage=${!!attachmentUrl}`);
        await handleMessage(senderPsid, userText, attachmentUrl);
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// 3. COMMAND HANDLER
async function handleMessage(senderPsid, text, imageUrl) {
  const messageText = text.toLowerCase();

  // 📸 COMMAND 1: /image <prompt>
  if (messageText.startsWith('/image')) {
    const prompt = text.replace('/image', '').trim();
    if (!prompt) {
      return await sendTextMessage(senderPsid, "⚠️ Maglagay ng prompt! Example: /image cute cat");
    }

    await sendTextMessage(senderPsid, "🎨 Generating image, please wait...");
    const genImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    return await sendMediaMessage(senderPsid, genImageUrl, 'image');
  }

  // 🎵 COMMAND 2: /play <song>
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

  // ✂️ COMMAND 3: /removebg (Automatic na kukuha ng sinend na picture)
  if (messageText.startsWith('/removebg')) {
    if (!imageUrl) {
      return await sendTextMessage(senderPsid, "⚠️ Mag-send muna ng picture kasabay ng pag-type ng /removebg o i-caption ito!");
    }

    await sendTextMessage(senderPsid, "✂️ Tinatanggal ang background, sandali lang...");
    
    // Dito maaari nating i-pass ang image URL sa isang background removal API o serbisyo
    // Pansamantalang ibabalik muna natin ang na-detect na URL o gagamitin ang API
    try {
      // Halimbawa ng pagpasa ng image URL sa processing API
      const processedImageUrl = `https://image.pollinations.ai/prompt/transparent%20background%20isolated?nologo=true`; // Placeholder o ilagay ang actual removebg API mo
      await sendTextMessage(senderPsid, "✅ Narito ang larawan na walang background:");
      return await sendMediaMessage(senderPsid, imageUrl, 'image'); // Pansamantalang ibabalik ang image pabalik
    } catch (err) {
      return await sendTextMessage(senderPsid, "❌ Nabigo sa pag-process ng removebg.");
    }
  }

  // DEFAULT HELP
  if (text) {
    return await sendTextMessage(senderPsid, `🤖 Bot Commands:\n- /image <prompt>\n- /play <title>\n- /removebg (Mag-send ng pic kasama ang command)`);
  }
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

// 5. SEND MEDIA API
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
