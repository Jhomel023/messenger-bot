'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    res.status(200).send('EVENT_RECEIVED');

    body.entry.forEach(entry => {
      if (entry.messaging && entry.messaging[0]) {
        const webhookEvent = entry.messaging[0];
        const senderId = webhookEvent.sender.id;

        if (webhookEvent.message && webhookEvent.message.text && !webhookEvent.message.is_echo) {
          const receivedMessageText = webhookEvent.message.text.trim();
          console.log(`Received message from ${senderId}: ${receivedMessageText}`);

          handleIncomingMessage(senderId, receivedMessageText);
        }
      }
    });
  } else {
    res.sendStatus(404);
  }
});

async function handleIncomingMessage(senderId, userMessage) {
  const lowerMsg = userMessage.toLowerCase();

  // 1. Handle /play or /music command for 30-sec audio/track snippet sending
  if (lowerMsg.startsWith('/play') || lowerMsg.startsWith('/music')) {
    // Halimbawa ng direct audio attachment (pwede mong palitan ng actual direct URL ng audio file)
    await sendMediaToMessenger(senderId, 'audio', 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3');
    return;
  }

  // 2. Handle Image Generation or Request queries
  if (lowerMsg.startsWith('/image') || lowerMsg.startsWith('/draw') || lowerMsg.includes('generate image')) {
    // Halimbawa ng direct image attachment (pwede ring palitan ng generated image URL mula sa AI)
    await sendMediaToMessenger(senderId, 'image', 'https://picsum.photos/800/600');
    return;
  }

  // 3. Handle AI generation and Math solving via Gemini 3.6 Flash
  try {
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: userMessage,
    });

    let responseText = aiResponse.text || "Sorry, the AI did not generate a response.";

    if (responseText.length > 2000) {
      responseText = responseText.substring(0, 1997) + "...";
    }

    await sendTextToMessenger(senderId, responseText);

  } catch (error) {
    console.error('Error with Gemini AI:', error);
    await sendTextToMessenger(senderId, "An error occurred while processing your request.");
  }
}

async function sendTextToMessenger(recipientId, messageText) {
  const requestData = {
    recipient: { id: recipientId },
    message: { text: messageText }
  };

  await callMessengerAPI(requestData);
}

async function sendMediaToMessenger(recipientId, type, mediaUrl) {
  const requestData = {
    recipient: { id: recipientId },
    message: {
      attachment: {
        type: type, // 'image' o 'audio'
        payload: {
          url: mediaUrl,
          is_reusable: true
        }
      }
    }
  };

  await callMessengerAPI(requestData);
}

async function callMessengerAPI(requestData) {
  try {
    const response = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData)
    });

    const data = await response.json();
    if (data.error) {
      console.error('Facebook API Error: ', data.error);
    } else {
      console.log('Media/Response sent successfully to Messenger!');
    }
  } catch (error) {
    console.error('Error sending to Messenger API:', error);
  }
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
