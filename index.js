'use strict';
const express = require('express');
const bodyParser = require('body-parser');
const { PDFDocument } = require('pdf-lib');
const PDFKit = require('pdfkit');
const mammoth = require('mammoth');

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 10000;
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const userLastImage = {};

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
  if (body && body.object === 'page' && body.entry) {
    body.entry.forEach(entry => {
      if (entry.messaging && entry.messaging[0]) {
        const ev = entry.messaging[0];
        const senderId = ev.sender?.id;
        if (senderId && ev.message && !ev.message.is_echo) {
          processIncomingMessage(senderId, ev.message).catch(err => {
            console.error('Unhandled Webhook Error:', err);
          });
        }
      }
    });
  }
});

async function processIncomingMessage(senderId, messageObj) {
  try {
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

    // /pdf COMMAND
    if (low.startsWith('/pdf') || low.startsWith('/topdf')) {
      await handleConvertToPdf(senderId, fileUrl, text);
      return;
    }

    // /removebg COMMAND
    if (low.startsWith('/removebg') || low.startsWith('/bgremove')) {
      await handleRemoveBg(senderId, fileUrl);
      return;
    }

    await handleMsg(senderId, text, fileUrl);
  } catch (globalErr) {
    console.error('Global Message Handler Error:', globalErr);
    await sendText(senderId, "An internal error occurred. Please try again.");
  }
}

// SAFE GEMINI REST API CALL
async function callGemini(promptText, systemInstruction = '') {
  if (!GEMINI_API_KEY) return null;

  const primaryUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
  
  const payload = {
    contents: [{
      parts: [{ text: promptText }]
    }]
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  try {
    let response = await fetch(primaryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      response = await fetch(fallbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini REST Error:', response.status, errText);
      return null;
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.error('Gemini Fetch Exception:', err);
    return null;
  }
}

async function handleConvertToPdf(senderId, fileUrl, text) {
  const contentText = text.replace(/\/pdf|\/topdf/i, '').trim();

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

  await sendText(senderId, "Please send an image or DOCX file first, then type /pdf.");
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
    await sendText(senderId, "Please send or reply to an image first before typing /removebg.");
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
      const errJson = await res.json().catch(() => ({}));
      await sendText(senderId, `Remove.bg error: ${errJson.errors?.[0]?.title || 'Failed to remove background.'}`);
    }
  } catch (e) {
    console.error('Removebg Error:', e);
    await sendText(senderId, "Error processing background removal.");
  }
}

async function handleMsg(senderId, text, imgUrl) {
  const low = text.toLowerCase();

  // HELP / MENU
  if (['/start', '/help', 'hi', 'hello'].includes(low)) {
    await sendText(
      senderId,
      "🤖 Pollar Bot Assistant\n\nCommands:\n📄 /pdf - Convert image/DOCX/text to PDF\n🎨 /image [Prompt] - Generate AI Image\n🎵 /play [Song Title] - Search music preview\n✂️ /removebg - Remove image background\n🧠 [Ask Question] - Ask Gemini AI"
    );
    return;
  }

  // MUSIC SEARCH (/play song)
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
      console.error('Music Search Error:', e);
      await sendText(senderId, "Error searching for song.");
    }
    return;
  }

  // AI IMAGE GENERATION
  if (low.startsWith('/image') || low.startsWith('/draw') || low.startsWith('/generate')) {
    const rawPrompt = text.replace(/\/image|\/draw|\/generate/i, '').trim();
    if (!rawPrompt) {
      await sendText(senderId, "Please provide a prompt. Example: /image orange cat");
      return;
    }

    await sendText(senderId, "Generating AI image...");

    let finalPrompt = rawPrompt;

    if (GEMINI_API_KEY) {
      const enhanced = await callGemini(
        `Convert this simple idea into a concise visual prompt for image generation under 25 words: ${rawPrompt}`
      );
      if (enhanced) {
        finalPrompt = enhanced.trim();
      } else {
        finalPrompt = `${rawPrompt}, highly detailed, 8k resolution, photorealistic`;
      }
    } else {
      finalPrompt = `${rawPrompt}, highly detailed, 8k resolution, photorealistic`;
    }

    try {
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?nologo=true&enhance=true`;
      
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('Failed to download image from generator');
      
      const arrayBuf = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      
      await sendFileBuffer(senderId, buffer, 'generated-image.jpg', 'image/jpeg');
    } catch (err) {
      console.error('Image Send Error:', err);
      await sendText(senderId, "Error sending generated image to Messenger.");
    }
    return;
  }

  if (!GEMINI_API_KEY) {
    await sendText(senderId, "GEMINI_API_KEY is missing or invalid.");
    return;
  }

  // DEFAULT GEMINI CHAT
  try {
    const cleanQuery = text.replace(/^\/math\s*/i, '').trim();
    const isMath = /\d+[\+\-\*\/\^]\d+|\b(solve|math)\b/i.test(text) || low.startsWith('/math');
    const sysPrompt = isMath 
      ? "You are a math tutor. Respond strictly in English. Provide only the final direct answer followed by a one-sentence step explanation." 
      : "You are a helpful assistant. Respond strictly in clear English. Be concise and direct.";

    const responseText = await callGemini(cleanQuery, sysPrompt);

    await sendText(senderId, responseText || "No response generated.");
  } catch (e) {
    console.error('Gemini AI Error:', e);
    await sendText(senderId, "Sorry, I am having trouble fetching the AI response right now. Please try again.");
  }
}

async function sendText(id, txt) {
  try {
    await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id }, message: { text: txt } })
    });
  } catch (err) {
    console.error('sendText Error:', err);
  }
}

async function sendMedia(id, type, url) {
  try {
    await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id }, message: { attachment: { type, payload: { url, is_reusable: true } } } })
    });
  } catch (err) {
    console.error('sendMedia Error:', err);
  }
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
