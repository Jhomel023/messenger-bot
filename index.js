'use strict';
const express = require('express');
const bodyParser = require('body-parser');
const { GoogleGenAI } = require('@google/genai');
const { PDFDocument } = require('pdf-lib');
const PDFKit = require('pdfkit');
const mammoth = require('mammoth');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const userLastImage = {};

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

  if (messageObj.attachments && messageObj.attachments[0]) {
    const att = messageObj.attachments[0];
    fileUrl = att.payload?.url;
    if (att.type === 'image' || fileUrl) {
      userLastImage[senderId] = fileUrl;
    }
  }

  if (!fileUrl && messageObj.reply_to && messageObj.reply_to.mid) {
    try {
      const graphRes = await fetch(
        `https://graph.facebook.com/v21.0/${messageObj.reply_to.mid}?fields=attachments&access_token=${PAGE_ACCESS_TOKEN}`
      );
      const data = await graphRes.json();
      fileUrl = data.attachments?.data?.[0]?.payload?.url || data.attachments?.data?.[0]?.image_data?.url;
    } catch (err) {
      console.error('FB Reply Fetch Error:', err);
    }
  }

  if (!fileUrl && userLastImage[senderId]) {
    fileUrl = userLastImage[senderId];
  }

  const low = text.toLowerCase();

  if (low.startsWith('/topdf') || low.startsWith('/pdf')) {
    await handleConvertToPdf(senderId, fileUrl, text);
    return;
  }

  if (fileUrl && (low.startsWith('/removebg') || low.startsWith('/bgremove'))) {
    await handleRemoveBg(senderId, fileUrl);
    return;
  }

  handleMsg(senderId, text, fileUrl);
}

async function handleConvertToPdf(senderId, fileUrl, text) {
  const contentText = text.replace(/\/topdf|\/pdf/i, '').trim();

  if (fileUrl) {
    await sendText(senderId, "Converting to PDF...");
    try {
      const fileRes = await fetch(fileUrl);
      const arrayBuffer = await fileRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (fileUrl.includes('.docx') || fileUrl.includes('.doc')) {
        const result = await mammoth.extractRawText({ buffer: buffer });
        const extractedText = result.value;

        if (!extractedText.trim()) {
          await sendText(senderId, "No text found inside the DOCX file.");
          return;
        }

        const pdfBuffer = await createPdfFromText(extractedText);
        delete userLastImage[senderId];
        await sendFileBuffer(senderId, pdfBuffer, 'converted-doc.pdf', 'application/pdf');
        return;
      }

      const pdfDoc = await PDFDocument.create();
      let image;
      try {
        image = await pdfDoc.embedJpg(buffer);
      } catch (e) {
        image = await pdfDoc.embedPng(buffer);
      }

      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

      const pdfBytes = await pdfDoc.save();
      delete userLastImage[senderId];

      await sendFileBuffer(senderId, Buffer.from(pdfBytes), 'converted-image.pdf', 'application/pdf');
    } catch (err) {
      console.error('PDF Conversion Error:', err);
      await sendText(senderId, "Error converting file to PDF.");
    }
    return;
  }

  if (contentText) {
    await sendText(senderId, "Converting text to PDF...");
    try {
      const pdfBuffer = await createPdfFromText(contentText);
      await sendFileBuffer(senderId, pdfBuffer, 'document.pdf', 'application/pdf');
    } catch (err) {
      await sendText(senderId, "Error generating PDF from text.");
    }
    return;
  }

  await sendText(senderId, "Please send an image or DOCX file first, then type /topdf.");
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
    await sendText(senderId, "Please send an image first before typing /removebg.");
    return;
  }
  if (!process.env.REMOVEBG_API_KEY) {
    await sendText(senderId, "Please set REMOVEBG_API_KEY in Render environment variables.");
    return;
  }
  await sendText(senderId, "Removing background...");
  try {
    const imgFetch = await fetch(imgUrl);
    if (!imgFetch.ok) {
      await sendText(senderId, "Failed to download image.");
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
      body: JSON.stringify({ image_file_b64: base64Image, size: 'auto' })
    });

    if (res.ok) {
      const resultBuffer = await res.arrayBuffer();
      delete userLastImage[senderId];
      await sendFileBuffer(senderId, Buffer.from(resultBuffer), 'removed-bg.png', 'image/png');
    } else {
      const errJson = await res.json();
      await sendText(senderId, `Remove.bg error: ${errJson.errors?.[0]?.title || 'Unknown error'}`);
    }
  } catch (e) {
    console.error('Removebg Error:', e);
    await sendText(senderId, "Error processing background removal.");
  }
}

async function handleMsg(senderId, text, imgUrl) {
  const low = text.toLowerCase();

  if (['/start', '/help', 'hi', 'hello'].includes(low)) {
    await sendText(senderId, "🤖 Pollar Bot Assistant\n\nCommands:\n🎵 /play [Song Title] - Search music\n🎨 /image [Prompt] - Generate AI Image\n✂️ /removebg - Remove image background\n📄 /topdf - Convert image/DOCX/text to PDF\n🧠 [Ask Question] - Ask Gemini AI");
    return;
  }

  if (low.startsWith('/play') || low.startsWith('/music')) {
    const q = text.replace(/\/play|\/music/i, '').trim();
    if (!q) {
      await sendText(senderId, "Please specify a song title. Example: /play Chase Atlantic");
      return;
    }
    try {
      const r = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=1`);
      const d = await r.json();
      if (d.data && d.data.length > 0) {
        await sendText(senderId, `Now playing: ${d.data[0].title} by ${d.data[0].artist.name}`);
        await sendMedia(senderId, 'audio', d.data[0].preview);
      } else {
        await sendText(senderId, "No song found.");
      }
    } catch (e) {
      await sendText(senderId, "Error searching for song.");
    }
    return;
  }

  if (low.startsWith('/image') || low.startsWith('/draw') || low.startsWith('/generate')) {
    const rawPrompt = text.replace(/\/image|\/draw|\/generate/i, '').trim() || 'Cinematic view';
    // Dagdagan ng quality keywords para mas maganda ang result ng Pollinations AI
    const enhancedPrompt = `${rawPrompt}, highly detailed, 8k resolution, photorealistic, masterpiece`;
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?nologo=true&enhance=true`;
    
    await sendText(senderId, "Generating AI image...");
    await sendMedia(senderId, 'image', imageUrl);
    return;
  }

  if (!ai) {
    await sendText(senderId, "GEMINI_API_KEY is missing or invalid.");
    return;
  }

  try {
    const isMath = /\d+[\+\-\*\/\^]\d+|\b(solve|math)\b/i.test(text);
    const sys = isMath ? "Respond in English. Give ONLY the final answer and a 1-sentence explanation." : "Respond in clear English. Be concise, direct, and helpful.";
    
    // Inayos ang model papuntang gemini-2.5-flash (In-update para sa free quota limits)
    const aiRes = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${sys}\n\nUser: ${text}`
    });
    await sendText(senderId, aiRes.text || "No response generated.");
  } catch (e) {
    console.error('Gemini AI Error:', e);
    if (e.status === 429 || (e.message && e.message.includes('Quota exceeded'))) {
      await sendText(senderId, "Daily free quota for Gemini AI exceeded. Please try again tomorrow.");
    } else {
      await sendText(senderId, "An error occurred with the AI response.");
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
      await sendText(id, "Error sending file to Messenger.");
    }
  } catch (err) {
    console.error('Fetch sendFileBuffer Error:', err);
  }
}

app.listen(PORT, '0.0.0.0', () => console.log(`Running on port ${PORT}`));
