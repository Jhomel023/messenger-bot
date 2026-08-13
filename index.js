const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Webhook Verification (Meta Messenger)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Receiving Messages
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(entry => {
      const webhook_event = entry.messaging[0];
      const sender_psid = webhook_event.sender.id;

      if (webhook_event.message) {
        handleMessage(sender_psid, webhook_event.message);
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// Handle Incoming Commands
async function handleMessage(sender_psid, received_message) {
  if (!received_message.text) return;

  const text = received_message.text.trim();

  // 📸 COMMAND 1: /image
  if (text.startsWith('/image')) {
    const prompt = text.replace('/image', '').trim();

    if (!prompt) {
      return callSendAPI(sender_psid, { text: "Maglagay ka ng prompt! Halimbawa: /image cute cat" });
    }

    await callSendAPI(sender_psid, { text: "🎨 Generating image, wait lang ng kaunti..." });

    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;

    callSendAPI(sender_psid, {
      attachment: {
        type: "image",
        payload: {
          url: imageUrl,
          is_reusable: true
        }
      }
    });
  } 

  // 🎵 COMMAND 2: /play or /music (SENDS DIRECT AUDIO ATTACHMENT)
  else if (text.startsWith('/play') || text.startsWith('/music')) {
    const songQuery = text.replace(/\/play|\/music/, '').trim();

    if (!songQuery) {
      return callSendAPI(sender_psid, { text: "Maglagay ka ng pamagat ng kanta! Halimbawa: /play paradise by chase atlantic" });
    }

    await callSendAPI(sender_psid, { text: `🎵 Hinahanap ang audio ng "${songQuery}", wait lang...` });

    try {
      // Direct MP3 Search via free audio API
      const searchUrl = `https://api.popcat.xyz/song?q=${encodeURIComponent(songQuery)}`;
      const response = await axios.get(searchUrl);

      if (response.data && response.data.download) {
        // Send direct audio attachment (mag-mumukhang audio player / record sa Messenger)
        callSendAPI(sender_psid, {
          attachment: {
            type: "audio",
            payload: {
              url: response.data.download,
              is_reusable: true
            }
          }
        });
      } else {
        callSendAPI(sender_psid, { text: `❌ Pasensya na, hindi nahanap ang audio file para sa "${songQuery}". Subukan ang ibang pamagat o artist.` });
      }
    } catch (error) {
      console.error("Music API Error:", error.message);
      callSendAPI(sender_psid, { text: "❌ Nagka-error sa pag-download ng audio. Subukan ulit maya-maya." });
    }
  } 

  // ❓ DEFAULT RESPONSE
  else {
    callSendAPI(sender_psid, { 
      text: `Nareceive ko: "${text}".\n\nMga pwedeng ibulong sakin:\n📸 /image <prompt>\n🎵 /play <song title>` 
    });
  }
}

// Send Message via Graph API
function callSendAPI(sender_psid, response) {
  const request_body = {
    recipient: {
      id: sender_psid
    },
    message: response
  };

  axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, request_body)
    .then(() => {
      console.log('Message sent!');
    })
    .catch(err => {
      console.error('Attachment error:', err.response ? err.response.data : err.message);
    });
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
