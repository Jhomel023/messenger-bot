'use strict';

const express = require('express');
const bodyParser = require('body-parser');
const request = require('request');

const app = express();
app.use(bodyParser.json());

// Port na gagamitin ni Render
const PORT = process.env.PORT || 10000;

// Palitan ito ng Page Access Token mo galing sa Meta Dashboard
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// 1. Webhook Verification (GET Request mula kay Meta)
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

// 2. Pag-receive ng Messages (POST Request mula kay Meta)
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(entry => {
      const webhookEvent = entry.messaging[0];
      console.log("May pumasok na webhook event:", webhookEvent);

      const senderId = webhookEvent.sender.id;

      // Kung may pinadalang text ang user
      if (webhookEvent.message && webhookEvent.message.text) {
        const receivedMessageText = webhookEvent.message.text;
        
        // Dito mo ilalagay ang sagot ng bot mo
        // Halimbawa, Echo bot muna o ang AI response mo:
        const responseText = "Sinabi mo: " + receivedMessageText;

        // Isinusuko natin dito ang pagsagot gamit ang function sa ibaba
        sendMessage(senderId, responseText);
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// 3. Function para magpadala ng mensahe (May kasama nang automatic trimmer para sa 2000 limit)
function sendMessage(recipientId, messageText) {
  
  // -- PAMPATIGIL NG ERROR 100: Kung lumagpas sa 2000 characters, puputulin natin --
  if (messageText && messageText.length > 2000) {
    messageText = messageText.substring(0, 1997) + "...";
  }
  ----------------------------------------------------------------------------------

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

// Simulan ang pag-run ng server
app.listen(PORT, () => {
  console.log(`Server is running and listening on port ${PORT}`);
});
