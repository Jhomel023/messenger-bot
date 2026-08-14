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
          const text = ev.message.text ? ev.message.text.trim() : '';
          let imgUrl = null;
          
          if (ev.message.attachments && ev.message.attachments[0]?.type === 'image') {
            imgUrl = ev.message.attachments[0].payload.url;
          }
          
          if (ev.message.reply_to) {
            const reply = ev.message.reply_to;
            if (reply.attachments && reply.attachments[0]?.type === 'image') {
              imgUrl = reply.attachments[0].payload.url;
            }
          }

          handleMsg(senderId, text, imgUrl);
        }
      }
    });
  }
});

async function handleMsg(senderId, text, imgUrl) {
  const low = text.toLowerCase();

  if (['/start', '/help', 'hi', 'hello'].includes(low)) {
    await sendText(senderId, "🤖 Bot ni Jhomel\n\nCommands:\n🎵 /play [Song]\n🎨 /image [Prompt]\n✂️ /removebg (I-reply sa pic)\n🧠 [Tanong o Math]");
    return;
  }

  if (low.startsWith('/removebg') || low.startsWith('/bgremove')) {
    if (!imgUrl) {
      await sendText(senderId, "Mangyaring i-reply ang /removebg sa larawan na nais mong tanggalan ng background.");
      return;
    }
    if (!process.env.REMOVEBG_API_KEY) {
      await sendText(senderId, "Mangyaring itakda ang REMOVEBG_API_KEY sa mga environment variable ng Render.");
      return;
    }
    await sendText(senderId, "Kasalukuyang tinatanggal ang background ng larawan...");
    try {
      const res = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': process.env.REMOVEBG_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imgUrl, size: 'auto' })
      });
      if (res.ok) {
        await sendText(senderId, "Matagumpay na naalis ang background ng larawan.");
      } else {
        await sendText(senderId, "Nagkaroon ng suliranin sa pagproseso gamit ang remove.bg API.");
      }
    } catch (e) {
      await sendText(senderId, "Nagka-error sa operasyon ng background removal.");
    }
    return;
  }

  if (low.startsWith('/play') || low.startsWith('/music')) {
    const q = text.replace(/\/play|\/music/i, '').trim();
    if (!q) {
      await sendText(senderId, "Maglagay ng pamagat ng kanta. Halimbawa: /play Chase Atlantic");
      return;
    }
    try {
      const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=1`);
      const d = await r.json();
      if (d.data && d.data.length > 0) {
        await sendText(senderId, `Now playing: ${d.data[0].title} by ${d.data[0].artist.name}`);
        await sendMedia(senderId, 'audio', d.data[0].preview);
      } else {
        await sendText(senderId, "Walang nahanap na kanta.");
      }
    } catch (e) {
      await sendText(senderId, "Error sa paghanap ng musika.");
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
    await sendText(senderId, "Error sa pagtugon ng AI.");
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

app.listen(PORT, () => console.log(`Running on port ${PORT}`));
