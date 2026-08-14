'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// I-initialize ang Gemini SDK (Gamit ang environment variable na GEMINI_API_KEY)
const ai = new GoogleGenAI();

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
    // Agad nating sinasagot si Meta ng 200 OK para hindi mag-timeout
    res.status(200).send('EVENT_RECEIVED');

    body.entry.forEach(entry => {
      if (entry.messaging && entry.messaging[0]) {
        const webhookEvent = entry.messaging[0];
        const senderId = webhookEvent.sender.id;

        // Siguraduhing text message ang pinadala at hindi galing sa page mismo
        if (webhookEvent.message && webhookEvent.message.text && !webhookEvent.message.is_echo) {
          const receivedMessageText = webhookEvent.message.text;
          console.log(`Natanggap na mensahe mula kay ${senderId}: ${receivedMessageText}`);

          // Tawagin ang AI para mag-generate ng sagot
          handleAiResponse(senderId, receivedMessageText);
        }
      }
    });
  } else {
    res.sendStatus(404);
  }
});

// Function para humingi ng sagot kay Gemini at i-send sa Messenger
async function handleAiResponse(senderId, userMessage) {
  try {
    // Humingi ng sagot kay Gemini gamit ang gemini-2.5-flash
    const aiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userMessage,
    });

    let responseText = aiResponse.text || "Pasensya na, hindi ko naiintindihan ang ibig mong sabihin.";

    // Proteksyon laban sa 2000 character limit ng Facebook Messenger
    if (responseText.length > 2000) {
      responseText = responseText.substring(0, 1997) + "...";
    }

    // I-send pabalik kay Messenger
    await sendToMessenger(senderId, responseText);

  } catch (error) {
    console.error('Error sa pag-generate ng AI response:', error);
    await sendToMessenger(senderId, "May naganap na error sa pagproseso ng iyong mensahe.");
  }
}

// Function para i-send ang mensahe sa Meta API
async function sendToMessenger(recipientId, messageText) {
  const requestData = {
    recipient: { id: recipientId },
    message: { text: messageText }
  };

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
      console.log('Naipadala na ang AI response sa Messenger!');
    }
  } catch (error) {
    console.error('Error sa pag-send sa Messenger API:', error);
  }
}

app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
});
