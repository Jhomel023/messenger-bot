'use strict';
const express = require('express');
const bodyParser = require('body-parser');
const { GoogleGenAI } = require('@google/genai');
const { PDFDocument } = require('pdf-lib');
const PDFKit = require('pdfkit');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

let ai;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

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
  let fileUrl = null;
  let fileType = null;

  if (messageObj.attachments && messageObj.attachments[0]) {
    fileUrl = messageObj.attachments[0].payload?.url;
    fileType = messageObj.attachments[0].type;
  }

  if (!fileUrl && messageObj.reply_to && messageObj.reply_to.mid) {
    try {
      const graphRes = await fetch(`https://graph.facebook.com/v21.0/${messageObj.reply_to.mid}?fields=attachments&access_token=${PAGE_ACCESS_TOKEN}`);
      const data = await graphRes.json();
      
      const attachment = data.attachments?.data?.[0];
      if (attachment) {
        fileUrl = attachment.payload?.url || attachment.file_url;
        fileType = attachment.type;
      }
    } catch (err) {
      console.error('Error sa pagkuha ng nireplyan na file:', err);
    }
  }

  const low = text.toLowerCase();

  if (low.startsWith('/topdf') || low.startsWith('/pdf')) {
    await handleConvertToPdf(senderId, fileUrl, fileType, text);
    return;
  }

  if (fileUrl && (low.startsWith('/removebg') || low.startsWith('/bgremove') || text === '')) {
    await handleRemoveBg(senderId, fileUrl);
    return;
  }

  if (low.startsWith('/removebg') || low.startsWith('/bgremove')) {
    await handleRemoveBg(senderId, fileUrl);
    return;
  }

  handleMsg(senderId, text, fileUrl);
}

async function handleConvertToPdf(senderId, fileUrl, fileType, text) {
  const contentText = text.replace(/\/topdf|\/pdf/i, '').trim();

  if (fileUrl) {
    await sendText(senderId, "Ginagawang PDF ang iyong larawan...");
    try {
      const imgRes = await fetch(fileUrl);
      const imgArrayBuffer = await imgRes.arrayBuffer();
      
      const pdfDoc = await PDFDocument.create();
      let image;
      
      try {
        image = await pdfDoc.embedJpg(imgArrayBuffer);
      } catch (e) {
        image = await pdfDoc.embedPng(imgArrayBuffer);
      }

      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

      const pdfBytes = await pdfDoc.save();
      await sendFileBuffer(senderId, Buffer.from(pdfBytes), 'converted.pdf', 'application/pdf');
    } catch (err) {
      console.error('PDF Conversion Error:', err);
      await sendText(senderId, "Nagka-error sa pag-convert ng image sa PDF.");
    }
    return;
  }

  if (contentText) {
    await sendText(senderId, "Ginagawang PDF ang iyong teksto...");
    try {
      const pdfBuffer = await createPdfFromText(contentText);
      await sendFileBuffer(senderId, pdfBuffer, 'document.pdf', 'application/pdf');
    } catch (err) {
      console.error('PDF Text Conversion Error:', err);
      await sendText(senderId, "Nagka-error sa paggawa ng PDF mula sa teksto.");
    }
    return;
  }

  await sendText(senderId, "Mag-reply ng /topdf sa isang larawan o kaya mag-type ng text tulad ng: /topdf [teksto mo dito]");
}

function createPdfFromText(text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFKit({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    doc.fontSize(12).text(text, { align: 'left' });
    doc.end();
  });
}

async function handleRemoveBg(senderId, imgUrl) {
  if (!imgUrl) {
    await sendText(senderId, "Mangyaring i-reply ang /removebg sa larawan o kaya i-attach ang larawan kasama ang caption na /removebg.");
    return;
  }
  if (!process.env.REMOVEBG_API_KEY) {
    await sendText(senderId, "I-set muna ang REMOVEBG_API_KEY sa Render environment variables.");
    return;
  }
  await sendText(senderId, "Tinatanggal ang background...");
  try {
    const imgFetch = await fetch(imgUrl);
    
    if (!imgFetch.ok) {
      await sendText(senderId, "Hindi ma-download ang larawan mula sa Facebook.");
      return;
    }

    const arrayBuffer = await imgFetch.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Image = buffer.toString('base64');

    const res = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 
        'X-Api-Key': process.env.REMOVEBG_API_KEY, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        image_file_b64: base64Image, 
        size: 'auto' 
      })
    });

    if (res.ok) {
      const resultBuffer = await res.arrayBuffer();
      await sendFileBuffer(senderId, Buffer.from(resultBuffer), 'removed-bg.png', 'image/png');
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
    await sendText(senderId, "🤖 Bot ni Jhomel\n\nCommands:\n🎵 /play [Song Title] - Maghanap at magpatugtog ng kanta\n🎨 /image [Prompt] - Gumawa ng AI image\n✂️ /removebg - Alisin ang background ng larawan\n📄 /topdf - Gawing PDF ang larawan o teksto\n🧠 [Tanong o Math] - Magtanong kay Gemini AI");
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

  if (!ai) {
    await sendText(senderId, "Maling API Key o hindi nakakabit ang GEMINI_API_KEY.");
    return;
  }

  try {
    const isMath = /\d+[\+\-\*\/\^]\d+|\b(solve|math)\b/i.test(text);
    const sys = isMath ? "Give ONLY the final answer and 1-sentence brief explanation." : "Be concise, direct, and friendly.";
    
    // Ginamit ang free-tier model (gemini-2.5-flash)
    const aiRes = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${sys}\n\nUser: ${text}`
    });
    await sendText(senderId, aiRes.text || "Walang na-generate na sagot.");
  } catch (e) {
    console.error('Gemini AI Error:', e);
    if (e.status === 429 || (e.message && e.message.includes('Quota exceeded'))) {
      await sendText(senderId, "Naubos na ang libreng quota limit ng Gemini API para sa araw na ito. Subukan bukas ulit.");
    } else {
      await sendText(senderId, "Error sa AI response.");
    }
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

async function sendFileBuffer(id, buffer, filename, contentType) {
  const boundary = '-----------------' + Date.now();
  const isImage = contentType.startsWith('image/');
  const attachmentType = isImage ? 'image' : 'file';

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="recipient"\r\n\r\n` +
    JSON.stringify({ id }) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="message"\r\n\r\n` +
    JSON.stringify({ attachment: { type: attachmentType, payload: { is_reusable: true } } }) + `\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="filedata"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n`
  );

  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const fullBody = Buffer.concat([header, buffer, footer]);

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: fullBody
    });
    
    const resJson = await res.json();
    if (!res.ok) {
      console.error('FB Send File Error:', resJson);
      await sendText(id, "Nagka-error sa pagpapadala ng file sa Messenger.");
    }
  } catch (err) {
    console.error('Fetch sendFileBuffer Error:', err);
  }
}

app.listen(PORT, '0.0.0.0', () => console.log(`Running on port ${PORT}`));
