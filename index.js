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

  // 1. MUSIC / PLAY COMMAND (Deezer 30-second Audio Preview)
  if (lowerMsg.startsWith('/play') || lowerMsg.startsWith('/music')) {
    const query = userMessage.replace(/\/play|\/music/i, '').trim();
    if (!query) {
      await sendTextToMessenger(senderId, "Please provide a song name. Example: /play Chase Atlantic");
      return;
    }

    await sendTextToMessenger(senderId, `Searching track for: "${query}"...`);

    try {
      const deezerRes = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=1`);
      const deezerData = await deezerRes.json();

      if (deezerData.data && deezerData.data.length > 0) {
        const track = deezerData.data[0];
        const previewUrl = track.preview; // 30-second MP3 preview link

        await sendTextToMessenger(senderId, `Now playing: ${track.title} by ${track.artist.name}`);
        await sendMediaToMessenger(senderId, 'audio', previewUrl);
      } else {
        await sendTextToMessenger(senderId, "Sorry, no matching track found.");
      }
    } catch (err) {
      console.error('Music Search Error:', err);
      await sendTextToMessenger(senderId, "An error occurred while fetching the track.");
    }
    return;
  }

  // 2. IMAGE GENERATION (Naka-lock)
  if (lowerMsg.startsWith('/image') || lowerMsg.startsWith('/draw') || lowerMsg.startsWith('/generate')) {
    const prompt = userMessage.replace(/\/image|\/draw|\/generate/i, '').trim();
    const encodedPrompt = encodeURIComponent(prompt || 'A beautiful scenery');
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;
    
    await sendMediaToMessenger(senderId, 'image', imageUrl);
    return;
  }

  // 3. MATH SOLVING & GENERAL AI (Gemini 3.6 Flash - Maikli at direkta)
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
