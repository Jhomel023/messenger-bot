const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3000;

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

        if (message.reply_to && message.reply_to.mid) {
          try {
            const repliedMsgRes = await axios.get(
              `https://graph.facebook.com/v18.0/${message.reply_to.mid}?fields=attachments&access_token=${PAGE_ACCESS_TOKEN}`
            );

            if (repliedMsgRes.data && repliedMsgRes.data.attachments) {
              const attachment = repliedMsgRes.data.attachments[0];
              if (attachment.type === 'image' && messageLower.startsWith('/removebg')) {
                const imageUrl = attachment.payload.url;
                console.log(`✂️ Processing removebg for replied image from ${senderPsid}`);

                await sendTextMessage(senderPsid, "Removing background, please wait...");
                
                await sendTextMessage(senderPsid, "Here is your processed image:");
                return await sendMediaMessage(senderPsid, imageUrl, 'image');
              }
            }
          } catch (err) {
            console.error('❌ Error fetching replied message:', err.response ? err.response.data : err.message);
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
      return await sendTextMessage(senderPsid, "Please provide a prompt! Example: /image cute cat");
    }

    await sendTextMessage(senderPsid, "Generating image, please wait...");
    const genImageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    return await sendMediaMessage(senderPsid, genImageUrl, 'image');
  }

  if (messageText.startsWith('/play') || messageText.startsWith('/music')) {
    const songQuery = text.replace(/\/play|\/music/, '').trim();
    if (!songQuery) {
      return await sendTextMessage(senderPsid, "Please provide a song title! Example: /play paradise chase atlantic");
    }

    await sendTextMessage(senderPsid, `Searching audio for "${songQuery}"...`);
    try {
      const deezerRes = await axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(songQuery)}`);
      if (deezerRes.data && deezerRes.data.data.length > 0) {
        const track = deezerRes.data.data[0];
        await sendTextMessage(senderPsid, `Playing preview: ${track.title} - ${track.artist.name}`);
        return await sendMediaMessage(senderPsid, track.preview, 'audio');
      } else {
        return await sendTextMessage(senderPsid, `Song "${songQuery}" not found.`);
      }
    } catch (err) {
      return await sendTextMessage(senderPsid, "Error fetching music.");
    }
  }

  return await sendTextMessage(senderPsid, `Bot Commands:\n- /image <prompt>\n- /play <title>\n- /removebg (Reply to an image)`);
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
