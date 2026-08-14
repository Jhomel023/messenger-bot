'use strict';

const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

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
          const receivedMessageText = webhookEvent.message.text;
          console.log(`Natanggap: ${receivedMessageText}`);

          // Dito pwedeng ilagay ang reply ng bot
          sendMessage(senderId, "Hello! Natanggap ko ang mensahe mo.");
        }
      }
    });
  } else {
    res.sendStatus(404);
  }
});

async function sendMessage(recipientId, messageText) {
  if (messageText && messageText.length > 2000) {
    messageText = messageText.substring(0, 1997) + "...";
  }

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
      console.log('Naipadala ang mensahe!');
    }
  } catch (error) {
    console.error('Error sa pag-send:', error);
  }
}

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
