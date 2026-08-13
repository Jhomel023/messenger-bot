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
  const messageText = received_message.text ? received_message.text.trim() : "";
  const attachments = received_message.attachments;

  // ✂️ COMMAND 1: /removebg (KAPAG MAY SAMA O REPLY NA PICTURE)
  if (messageText.startsWith('/removebg') || messageText.startsWith('/nobg')) {
    let targetImageUrl = null;

    // Check if the user attached an image with the command
    if (attachments && attachments[0] && attachments[0].type === 'image') {
      targetImageUrl = attachments[0].payload.url;
    } 
    // Check if user replied to an image message
    else if (received_message.reply_to && received_message.reply_to.attachments && received_message.reply_to.attachments[0].type === 'image') {
      targetImageUrl = received_message.reply_to.attachments[0].payload.url;
    }

    if (!targetImageUrl) {
      return callSendAPI(sender_psid, { 
        text: "Please send or reply to an image with the command /removebg !" 
      });
    }

    await callSendAPI(sender_psid, { text: "✂️ Removing background, please wait..." });

    // Free background removal service via Pollinations API
    const processedBgUrl = `https://image.pollinations.ai/prompt/remove%20background%20isolated%20on%20transparent?image=${encodeURIComponent(targetImageUrl)}`;

    return callSendAPI(sender_psid, {
      attachment: {
        type: "image",
        payload: {
          url: processedBgUrl,
          is_reusable: true
        }
      }
    });
  }

  // 📸 COMMAND 2: /image <prompt>
  if (messageText.startsWith('/image')) {
    const prompt = messageText.replace('/image', '').trim();

    if (!prompt) {
      return callSendAPI(sender_psid, { text: "Please provide a prompt! Example: /image cute cat" });
    }

    await callSendAPI(sender_psid, { text: "🎨 Generating image, please wait..." });

    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;

    return callSendAPI(sender_psid, {
      attachment: {
        type: "image",
        payload: {
          url: imageUrl,
          is_reusable: true
        }
      }
    });
  } 

  // 🎵 COMMAND 3: /play or /music <title>
  if (messageText.startsWith('/play') || messageText.startsWith('/music')) {
    const songQuery = messageText.replace(/\/play|\/music/, '').trim();

    if (!songQuery) {
      return callSendAPI(sender_psid, { text: "Please provide a song title! Example: /play paradise by chase atlantic" });
    }

    await callSendAPI(sender_psid, { text: `🎵 Searching audio for "${songQuery}"...` });

    try {
      const deezerRes = await axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(songQuery)}`);

      if (deezerRes.data && deezerRes.data.data.length > 0) {
        const track = deezerRes.data.data[0];
        const audioUrl = track.preview;

        await callSendAPI(sender_psid, { text: `🎶 Playing preview: ${track.title} - ${track.artist.name}` });

        return callSendAPI(sender_psid, {
          attachment: {
            type: "audio",
            payload: {
              url: audioUrl,
              is_reusable: true
            }
          }
        });
      } else {
        return callSendAPI(sender_psid, { text: `❌ Song "${songQuery}" not found. Try another title!` });
      }
    } catch (err) {
      console.error("Audio error:", err.message);
      return callSendAPI(sender_psid, { text: "❌ Failed to fetch audio record. Please try again." });
    }
  } 

  // ❓ DEFAULT RESPONSE
  if (messageText) {
    callSendAPI(sender_psid, { 
      text: `Received: "${messageText}".\n\nAvailable commands:\n📸 /image <prompt>\n🎵 /play <song title>\n✂️ /removebg (send or reply to a photo)` 
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
