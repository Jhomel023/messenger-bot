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
      return callSendAPI(sender_psid, { text: "Please provide a prompt! Example: /image cute cat" });
    }

    await callSendAPI(sender_psid, { text: "🎨 Generating image, please wait..." });

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

  // 🎵 COMMAND 2: /play or /music
  else if (text.startsWith('/play') || text.startsWith('/music')) {
    const songQuery = text.replace(/\/play|\/music/, '').trim();

    if (!songQuery) {
      return callSendAPI(sender_psid, { text: "Please provide a song title! Example: /play paradise by chase atlantic" });
    }

    const youtubeSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(songQuery)}`;

    callSendAPI(sender_psid, {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: `🎶 Here is what I found for "${songQuery}". Click below to listen:`,
          buttons: [
            {
              type: "web_url",
              url: youtubeSearchUrl,
              title: "▶️ Play Song"
            }
          ]
        }
      }
    });
  } 

  // ❓ DEFAULT RESPONSE
  else {
    callSendAPI(sender_psid, { 
      text: `Received: "${text}".\n\nAvailable commands:\n📸 /image <prompt>\n🎵 /play <song title>` 
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
