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
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', (req, res) => {
  res.status(200).send('EVENT_RECEIVED');
  const body = req.body;
  if (body.object === 'page') {
    body.entry.forEach(entry => {
      if (entry.messaging && entry.messaging[0]) {
        const ev = entry.messaging[0];
        const senderId = ev.sender.id;
        if (ev.message && !ev.message.is_echo) {
          processIncomingMessage(senderId, ev.message);
        }
      }
    });
  }
});

async function processIncomingMessage(senderId, messageObj) {
  const text = messageObj.text ? messageObj.text.trim() : '';
  let imgUrl = null;

  // 1. Direktang may attachment (image) sa current message
  if (messageObj.attachments && messageObj.attachments[0]?.type === 'image') {
    imgUrl = messageObj.attachments[0].payload.url;
  }

  // 2. Kung nag-reply sa isang mensahe (Gamit ang reply_to object ng Messenger API)
  if (!imgUrl && messageObj.reply_to && messageObj.reply_to.mid) {
    try {
      const graphRes = await fetch(`https://graph.facebook.com/v21.0/${messageObj.reply_to.mid}?fields=attachments&access_token=${PAGE_ACCESS_TOKEN}`);
      const data = await graphRes.json();
      
      if (data.attachments && data.attachments.data && data.attachments.data[0]?.type === 'image') {
        imgUrl = data.attachments.data[0].payload.url;
      }
    } catch (err) {
      console.error('Error sa pagkuha ng nireplyan na pic:', err);
    }
  }

  // Kung ang command ay /removebg pero nag-attach ng pic o nag-reply sa pic
  const low = text.toLowerCase();
  if (low.startsWith('/removebg') || low.startsWith('/bgremove') || (imgUrl && text === '')) {
    await handleRemoveBg(senderId, imgUrl);
    return;
  }

  handleMsg(senderId, text, imgUrl);
}

async function handleRemoveBg(senderId, imgUrl) {
  if (!imgUrl) {
    await sendText(senderId, "Mangyaring mag-attach ng larawan o i-reply ang /removebg sa mismong larawan.");
    return;
  }
  if (!process.env.REMOVEBG_API_KEY) {
    await sendText(senderId, "I-set muna ang REMOVEBG_API_KEY sa Render environment variables.");
    return;
  }
  await sendText(senderId, "Tinatanggal ang background...");
  try {
    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 
        'X-Api-Key': process.env.REMOVEBG_API_KEY, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        image_url: imgUrl, 
        size: 'auto' 
      })
    });

    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      await sendImageBuffer(senderId, buffer);
    } else {
      const errJson = await res.json();
      await sendText(senderId, `Error sa remove.bg: ${errJson.errors?.[0]?.title || 'Unknown error'}`);
    }
  } catch (e) {
    console.error('Removebg Error:', e);
    await sendText(senderId, "Nagka-error sa pagproseso ng background removal.");
  }
}

async function handleMsg(senderId, text, imgUrl) {
  const low = text.toLowerCase();

  if (['/start', '/help', 'hi', 'hello'].includes(low)) {
    await sendText(senderId, "🤖 Bot ni Jhomel\n\nCommands:\n🎵 /play [Song Title] - Maghanap at magpatugtog ng kanta\n🎨 /image [Prompt] - Gumawa ng AI image\n✂️ /removebg - I-reply o i-attach sa larawan para alisin ang background\n🧠 [Tanong o Math] - Magtanong kay Gemini AI");
    return;
  }

  if (low.startsWith('/play') || low.startsWith('/music')) {
    const q = text.replace(/\/play|\/music/i, '').trim();
    if (!q) {
      await sendText(senderId, "Maglagay ng kanta. Halimbawa: /play Chase Atlantic");
      return;
    }
    try {
      const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=1`);
      const d = await r.json();
      if (d.data && d.data.length > 0) {
        await sendText(senderId, `Now playing: ${d.data[0].title} by ${d.data[0].artist.name}`);
        await sendMedia(senderId, 'audio', d.data[0].preview);
      } else {
        await sendText(senderId, "Walang nakitang kanta.");
      }
    } catch (e) {
      await sendText(senderId, "Error sa paghanap ng kanta.");
    }
    return;
  }

  if (low.startsWith('/image') || low.startsWith('/draw') || low.startsWith('/generate')) {
    const p = text.replace(/\/image|\/draw|\/generate/i, '').trim() || 'Cinematic view';
    await sendMedia(senderId, 'image', `https://image.pollinations.ai/prompt/${encodeURIComponent(p)}`);
    return;
  }

  try {
    const isMath = /\d+[\+\-\*\/\^]\d+|\b(solve|math)\b/i.test(text);
    const sys = isMath ? "Give ONLY the final answer and 1-sentence brief explanation." : "Be concise, direct, and friendly.";
    const aiRes = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: `${sys}\n\nUser: ${text}`
    });
    await sendText(senderId, aiRes.text || "Walang na-generate na sagot.");
  } catch (e) {
    await sendText(senderId, "Error sa AI response.");
  }
}

async function sendText(id, txt) {
  await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id }, message: { text: txt } })
  });
}

async function sendMedia(id, type, url) {
  await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id }, message: { attachment: { type, payload: { url, is_reusable: true } } } })
  });
}

async function sendImageBuffer(id, buffer) {
  const formData = new FormData();
  formData.append('recipient', JSON.stringify({ id }));
  formData.append('message', JSON.stringify({ attachment: { type: 'image', payload: { is_reusable: true } } }));
  formData.append('filedata', new Blob([buffer], { type: 'image/png' }), 'removed-bg.png');

  await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    method: 'POST',
    body: formData
  });
}

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
