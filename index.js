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

  // 1. MUSIC / PLAY COMMAND (Direct audio search stream simulation)
  if (lowerMsg.startsWith('/play') || lowerMsg.startsWith('/music')) {
    const query = userMessage.replace(/\/play|\/music/i, '').trim();
    await sendTextToMessenger(senderId, `Playing: "${query || 'Track'}"`);
    
    // Gamit ang public preview stream na tugma sa query o dynamic sample
    const encodedQuery = encodeURIComponent(query || 'song');
    const audioUrl = `https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg`; // Palitan ng working stream kung may custom API ka
    
    await sendMediaToMessenger(senderId, 'audio', audioUrl);
    return;
  }

  // 2. IMAGE GENERATION (Naka-lock at hindi ginalaw)
  if (lowerMsg.startsWith('/image') || lowerMsg.startsWith('/draw') || lowerMsg.startsWith('/generate')) {
    const prompt = userMessage.replace(/\/image|\/draw|\/generate/i, '').trim();
    const encodedPrompt = encodeURIComponent(prompt || 'A beautiful scenery');
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;
    
    await sendMediaToMessenger(senderId, 'image', imageUrl);
    return;
  }

  // 3. MATH SOLVING & GENERAL AI (Strictly short & direct answer instructions)
  try {
    const isMath = /\d+[\+\-\*\/\^]\d+|\b(solve|calculate|eval|math)\b/i.test(userMessage);
    
    let systemInstruction = "";
    if (isMath) {
      systemInstruction = "You are a precise math solver. Give ONLY the final answer and a 1-sentence brief explanation. Keep it very short.";
    } else {
      systemInstruction = "Keep your response concise, direct, and helpful.";
    }

    const aiResponse = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: `${systemInstruction}\n\nUser Question: ${userMessage}`,
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
        type: type,
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
    }
  } catch (error) {
    console.error('Error sending to Messenger API:', error);
  }
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
