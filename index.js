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

  if (low.startsWith('/pdf') || low.startsWith('/topdf')) {
    await handleConvertToPdf(senderId, fileUrl, text);
    return;
  }

  if (fileUrl && (low.startsWith('/removebg') || low.startsWith('/bgremove'))) {
    await handleRemoveBg(senderId, fileUrl);
    return;
  }

  await handleMsg(senderId, text, fileUrl);
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

  // HELP / MENU
  if (['/start', '/help', 'hi', 'hello'].includes(low)) {
    await sendText(
      senderId,
      "🤖 Pollar Bot Assistant\n\n📄 /pdf - Convert image/DOCX/text to PDF\n🌐 /tr [Text] - Translate Tagalog <-> English\n📱 /qr [Link/Text] - Generate QR Code\n🔱 /fx [Amount] [From] [To] - Currency converter\n🌤️ /weather [City] - Live weather report\n🗣️ /say [Text] - Text-To-Speech voice note\n🔗 /short [Link] - Shorten long URLs\n📸 /ss [Link] - Screenshot website\n📚 /wiki [Topic] - Wikipedia search\n📖 /dict [Word] - Dictionary lookup\n🎨 /image [Prompt] - Generate AI Image\n🎵 /play [Song Title] - Search music preview\n✂️ /removebg - Remove image background\n🧠 [Ask Question] - Ask Gemini AI"
    );
    return;
  }

  // CURRENCY CONVERTER (/fx 100 USD PHP)
  if (low.startsWith('/fx') || low.startsWith('/convert')) {
    const parts = text.replace(/\/fx|\/convert/i, '').trim().split(/\s+/);
    if (parts.length < 3) {
      await sendText(senderId, "Format: /fx [amount] [from] [to]\nExample: /fx 100 USD PHP");
      return;
    }
    const amount = parseFloat(parts[0]);
    const from = parts[1].toUpperCase();
    const to = parts[2].toUpperCase();
    if (isNaN(amount)) {
      await sendText(senderId, "Please enter a valid amount.");
      return;
    }
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
      const data = await res.json();
      if (data.result === 'success' && data.rates && data.rates[to]) {
        const rate = data.rates[to];
        const converted = (amount * rate).toFixed(2);
        await sendText(senderId, `🔱 ${amount} ${from} = ${converted} ${to}\n(Rate: 1 ${from} = ${rate} ${to})`);
      } else {
        await sendText(senderId, "Unsupported currency code.");
      }
    } catch (e) {
      await sendText(senderId, "Error fetching exchange rates.");
    }
    return;
  }

  // DICTIONARY LOOKUP (/dict word)
  if (low.startsWith('/dict') || low.startsWith('/define')) {
    const word = text.replace(/\/dict|\/define/i, '').trim();
    if (!word) {
      await sendText(senderId, "Please specify a word. Example: /dict persistent");
      return;
    }
    try {
      const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
      const data = await res.json();
      if (Array.isArray(data) && data[0]?.meanings?.[0]?.definitions?.[0]?.definition) {
        const def = data[0].meanings[0].definitions[0].definition;
        const pos = data[0].meanings[0].partOfSpeech || '';
        await sendText(senderId, `📖 ${data[0].word} (${pos}):\n${def}`);
      } else {
        await sendText(senderId, "Word definition not found.");
      }
    } catch (e) {
      await sendText(senderId, "Error fetching definition.");
    }
    return;
  }

  // WEBSITE SCREENSHOT (/ss link)
  if (low.startsWith('/ss') || low.startsWith('/screenshot')) {
    const siteUrl = text.replace(/\/ss|\/screenshot/i, '').trim();
    if (!siteUrl) {
      await sendText(senderId, "Please provide a URL. Example: /ss https://google.com");
      return;
    }
    await sendText(senderId, "Taking website screenshot...");
    try {
      const ssApi = `https://api.microlink.io/?url=${encodeURIComponent(siteUrl)}&screenshot=true`;
      const res = await fetch(ssApi);
      const json = await res.json();
      if (json.data && json.data.screenshot && json.data.screenshot.url) {
        const imgRes = await fetch(json.data.screenshot.url);
        const arrayBuf = await imgRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        await sendFileBuffer(senderId, buffer, 'screenshot.jpg', 'image/jpeg');
      } else {
        await sendText(senderId, "Could not capture website screenshot.");
      }
    } catch (e) {
      console.error('Screenshot Error:', e);
      await sendText(senderId, "Error generating screenshot.");
    }
    return;
  }

  // URL SHORTENER (/short link)
  if (low.startsWith('/short') || low.startsWith('/shorten')) {
    const longUrl = text.replace(/\/short|\/shorten/i, '').trim();
    if (!longUrl) {
      await sendText(senderId, "Please provide a long link. Example: /short https://example.com/very-long-url");
      return;
    }
    try {
      const res = await fetch(`https://is.gd/create.php?format=json&url=${encodeURIComponent(longUrl)}`);
      const data = await res.json();
      if (data.shorturl) {
        await sendText(senderId, `🔗 Shortened Link:\n${data.shorturl}`);
      } else {
        await sendText(senderId, "Failed to shorten link.");
      }
    } catch (e) {
      await sendText(senderId, "Error shortening link.");
    }
    return;
  }

  // WEATHER REPORT (/weather city)
  if (low.startsWith('/weather') || low.startsWith('/panahon')) {
    const city = text.replace(/\/weather|\/panahon/i, '').trim() || 'Manila';
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`);
      const weatherText = await res.text();
      await sendText(senderId, `🌤️ Weather Report:\n${weatherText.trim()}`);
    } catch (e) {
      await sendText(senderId, "Error fetching weather report.");
    }
    return;
  }

  // TEXT TO SPEECH AUDIO VOICE NOTE (/say text)
  if (low.startsWith('/say') || low.startsWith('/tts')) {
    const speechText = text.replace(/\/say|\/tts/i, '').trim();
    if (!speechText) {
      await sendText(senderId, "Please provide text. Example: /say Hello world!");
      return;
    }
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(speechText)}`;
    await sendMedia(senderId, 'audio', ttsUrl);
    return;
  }

  // WIKIPEDIA SEARCH (/wiki topic)
  if (low.startsWith('/wiki')) {
    const query = text.replace(/\/wiki/i, '').trim();
    if (!query) {
      await sendText(senderId, "Please provide a topic. Example: /wiki Rizal");
      return;
    }
    try {
      const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.extract) {
        await sendText(senderId, `📚 ${data.title}\n\n${data.extract}`);
      } else {
        await sendText(senderId, "No Wikipedia article found.");
      }
    } catch (e) {
      await sendText(senderId, "Error searching Wikipedia.");
    }
    return;
  }

  // QR CODE GENERATOR (/qr link)
  if (low.startsWith('/qr')) {
    const qrText = text.replace(/\/qr/i, '').trim();
    if (!qrText) {
      await sendText(senderId, "Please provide a link or text. Example: /qr https://google.com");
      return;
    }
    await sendText(senderId, "Generating QR Code...");
    try {
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&data=${encodeURIComponent(qrText)}`;
      const qrRes = await fetch(qrUrl);
      if (!qrRes.ok) throw new Error('Failed to fetch QR image');
      const arrayBuf = await qrRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      await sendFileBuffer(senderId, buffer, 'qrcode.png', 'image/png');
    } catch (e) {
      console.error('QR Error:', e);
      await sendText(senderId, "Error generating QR code.");
    }
    return;
  }

  // TRANSLATOR (/tr text)
  if (low.startsWith('/tr') || low.startsWith('/translate')) {
    const transText = text.replace(/\/tr|\/translate/i, '').trim();
    if (!transText) {
      await sendText(senderId, "Please provide text to translate. Example: /tr Magandang umaga");
      return;
    }
    if (!ai) {
      await sendText(senderId, "GEMINI_API_KEY is missing or invalid.");
      return;
    }
    try {
      const aiRes = await ai.models.generateContent({
        model: 'gemini-1.5-flash',
        contents: `Translate the following text accurately. If it is in Tagalog/Filipino, translate to English. If in English or another language, translate to Tagalog. Provide ONLY the final translation without explanations:\n\n${transText}`
      });
      await sendText(senderId, aiRes.text ? aiRes.text.trim() : "Translation failed.");
    } catch (e) {
      console.error('Translation Error:', e);
      await sendText(senderId, "Error processing translation.");
    }
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
      await sendText(senderId, "Error searching for song.");
    }
    return;
  }

  // IMAGE GENERATION WITH BUFFER UPLOAD FIX
  if (low.startsWith('/image') || low.startsWith('/draw') || low.startsWith('/generate')) {
    const rawPrompt = text.replace(/\/image|\/draw|\/generate/i, '').trim();
    if (!rawPrompt) {
      await sendText(senderId, "Please provide a prompt. Example: /image orange cat");
      return;
    }

    await sendText(senderId, "Generating AI image...");

    let finalPrompt = rawPrompt;

    if (ai) {
      try {
        const geminiPromptResponse = await ai.models.generateContent({
          model: 'gemini-1.5-flash',
          contents: `Convert this simple idea into a concise visual prompt for image generation under 25 words: ${rawPrompt}`
        });

        if (geminiPromptResponse && geminiPromptResponse.text) {
          finalPrompt = geminiPromptResponse.text.trim();
        }
      } catch (err) {
        console.error('Gemini prompt enhancement bypassed:', err);
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

  if (!ai) {
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

    const aiRes = await ai.models.generateContent({
      model: 'gemini-1.5-flash',
      contents: `${sysPrompt}\n\nUser: ${cleanQuery}`
    });

    await sendText(senderId, aiRes.text || "No response generated.");
  } catch (e) {
    console.error('Gemini AI Error:', e);
    await sendText(senderId, "Sorry, I am having trouble fetching the AI response right now. Please try again.");
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
