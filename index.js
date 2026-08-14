'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');

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
    body.entry.forEach(entry => {
      const webhookEvent = entry.messaging[0];
      console.log("May pumasok na webhook event:", webhookEvent);

      const senderId = webhookEvent.sender.id;

      if (webhookEvent.message && webhookEvent.message.text) {
        const receivedMessageText = webhookEvent.message.text;
        const responseText = "Sinabi mo: " + receivedMessageText;

        sendMessage(senderId, responseText);
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

function sendMessage(recipientId, messageText) {
  if (messageText && messageText.length > 2000) {
    messageText = messageText.substring(0, 1997) + "...";
  }

  const requestData = {
    recipient: { id: recipientId },
    message: { text: messageText }
  };

  request({
    url: 'https://graph.facebook.com/v21.0/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: requestData
  }, (error, response, body) => {
    if (error) {
      console.error('Error sending message: ', error);
    } else if (body.error) {
      console.error('Facebook API Error: ', body.error);
    } else {
      console.log('Message sent successfully!');
    }
  });
}

app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
});
