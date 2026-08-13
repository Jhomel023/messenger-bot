const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// 1. Webhook Verification Endpoint
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('WEBHOOK_VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 2. Incoming Messages Listener (Works for Direct Messages & Group Chats)
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(async (entry) => {
      if (!entry.messaging) return;
      
      const webhookEvent = entry.messaging[0];
      // Target Group ID or Sender ID
      const recipientId = webhookEvent.thread_id || webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const userText = webhookEvent.message.text;
        await handleBotCommand(recipientId, userText);
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// 3. Command Handler
async function handleBotCommand(recipientId, text) {
  const lowerText = text.trim().toLowerCase();

  // Command: /image <prompt>
  if (lowerText.startsWith('/image ')) {
    const prompt = encodeURIComponent(text.replace(/\/image\s+/i, ''));
    // Pollinations.ai (Free Image Generator)
    const imageUrl = `https://pollinations.ai/p/${prompt}?width=1024&height=1024&seed=${Math.floor(Math.random() * 1000)}`;
    
    await sendMessengerAttachment(recipientId, 'image', imageUrl);
  } 
  // Command: /help or bot
  else if (lowerText === '/help' || lowerText === 'bot') {
    await sendMessengerText(
      recipientId, 
      "🤖 AI Bot Commands:\n\n" +
      "🖼️ `/image <prompt>` - Generate photo\n" +
      " Halimbawa: `/image futuristic cyberpunk city`"
    );
  }
}

// 4. Helper: Send Text
async function sendMessengerText(recipientId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: recipientId },
        message: { text: text }
      }
    );
  } catch (err) {
    console.error('Text error:', err.response?.data || err.message);
  }
}

// 5. Helper: Send Image Attachment
async function sendMessengerAttachment(recipientId, type, url) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
      {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: type,
            payload: { url: url, is_reusable: true }
          }
        }
      }
    );
  } catch (err) {
    console.error('Attachment error:', err.response?.data || err.message);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));