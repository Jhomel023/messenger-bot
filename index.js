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

        if (webhookEvent.message && !webhookEvent.message.is_echo) {
          const messageObj = webhookEvent.message;
          const receivedMessageText = messageObj.text ? messageObj.text.trim() : '';
          
          let attachmentUrl = null;

          if (messageObj.attachments && messageObj.attachments.length > 0) {
            const attachment = messageObj.attachments[0];
            if (attachment.type === 'image') {
              attachmentUrl = attachment.payload.url;
            }
          }

          if (messageObj.reply_to && messageObj.reply_to.attachments && messageObj.reply_to.attachments.length > 0) {
            const repliedAttachment = messageObj.reply_to.attachments[0];
            if (repliedAttachment.type === 'image') {
              attachmentUrl = repliedAttachment.payload.url;
            }
          }

          console.log(`Received message from ${senderId}: ${receivedMessageText || '[Attachment]'}`);
          handleIncomingMessage(senderId, receivedMessageText, attachmentUrl);
        }
      }
    });
  } else {
    res.sendStatus(404);
  }
});

async function handleIncomingMessage(senderId, userMessage, attachmentUrl) {
  const lowerMsg = userMessage.toLowerCase();

  if (lowerMsg === '/start' || lowerMsg === '/help' || lowerMsg === 'hi' || lowerMsg === 'hello') {
    const introText = 
      `🤖 Maligayang pagdating sa Bot ni Jhomel!\n\n` +
      `Narito ang mga maaari mong gawin:\n` +
      `🎵 /play [Song Name] - Makinig sa 30s music preview\n` +
      `🎨 /image [Prompt] - Gumawa ng AI image\n` +
      `✂️ /removebg - I-reply ito sa isang larawan para maalis ang background\n` +
      `🧠 [Tanong mo] o /math [Equation] - Q&A at pag-solve ng math\n\n` +
      `I-type lang ang iyong command o tanong!`;
    
    await sendTextToMessenger(senderId, introText);
    return;
  }

  if (lowerMsg.startsWith('/removebg') || lowerMsg.startsWith('/bgremove')) {
    if (!attachmentUrl) {
      await sendTextToMessenger(senderId, "Mangyaring i-reply ang command na ito sa isang larawan o kaya ay mag-send ng larawan na may caption na `/removebg`.");
      return;
    }

    await sendTextToMessenger(senderId, "Inaalis ang background ng larawan, pakihintay sandali...");

    try {
      const removeBgApiKey = process.env.REMOVEBG_API_KEY;
      if (!removeBgApiKey) {
        await sendTextToMessenger(senderId, "Paumanhin, kailangan i-set ang REMOVEBG_API_KEY sa Render environment variables para mapagana ang background removal API.");
        return;
      }

      const apiResponse = await fetch(`https://api.remove.bg/v1.0/removebg`, {
        method: 'POST',
        headers: {
          'X-Api-Key': removeBgApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          image_url: attachmentUrl,
          size: 'auto'
        })
      });

      if (apiResponse.ok) {
        await sendTextToMessenger(senderId, "Matagumpay na naalis ang background!");
      } else {
        await sendTextToMessenger(senderId, "May error sa pagproseso ng larawan sa remove.bg API.");
      }

    } catch (err) {
      console.error('RemoveBG Error:', err);
      await sendTextToMessenger(senderId, "Hindi naproseso ang background removal.");
    }
    return;
  }

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
        const previewUrl = track.preview;

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

  if (lowerMsg.startsWith('/image') || lowerMsg.startsWith('/draw') || lowerMsg.startsWith('/generate')) {
    const prompt = userMessage.replace(/\/image|\/draw|\/generate/i, '').trim();
    const cleanPrompt = prompt || 'A beautiful cinematic shot';
    const encodedPrompt = encodeURIComponent(`${cleanPrompt}, highly detailed, 8k, photorealistic, masterpiece, trending on artstation, ultra-realistic`);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;
    
    await sendMediaToMessenger(senderId, 'image', imageUrl);
    return;
  }

  try {
    const isMath = /\d+[\+\-\*\/\^]\d+|\b(solve|calculate|eval|math)\b/i.test(userMessage);
    
    let systemInstruction = "";
    if (isMath) {
      systemInstruction = "You are a precise math solver. Give ONLY the final answer and a 1-sentence brief explanation. Keep it very short.";
    } else {
      systemInstruction = "You are the AI assistant inside 'Bot ni Jhomel'. Keep your response concise, direct, helpful, and friendly.";
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
```[cite: 1]
