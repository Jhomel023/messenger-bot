const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const express = require('express');

// Express Server to keep Render Web Service happy
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('Telegram Bot Status: Online!');
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Telegram Bot Token from @BotFather
const token = '8808601643:AAEQQGieyp7cFXNTheycYPXexISApYkye2Y';
const bot = new TelegramBot(token, { polling: true });

console.log('Telegram bot is starting...');

// 📸 COMMAND 1: /image <prompt>
bot.onText(/\/image (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const prompt = match[1];

  bot.sendMessage(chatId, '🎨 Generating image, please wait...');

  try {
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true`;
    await bot.sendPhoto(chatId, imageUrl, { caption: `Prompt: ${prompt}` });
  } catch (err) {
    console.error('Image error:', err.message);
    bot.sendMessage(chatId, '❌ Failed to generate image.');
  }
});

// 🎵 COMMAND 2: /play or /music <song title>
bot.onText(/\/(play|music) (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const songQuery = match[2];

  bot.sendMessage(chatId, `🎵 Searching audio for "${songQuery}"...`);

  try {
    const deezerRes = await axios.get(`https://api.deezer.com/search?q=${encodeURIComponent(songQuery)}`);

    if (deezerRes.data && deezerRes.data.data.length > 0) {
      const track = deezerRes.data.data[0];
      const audioUrl = track.preview;

      await bot.sendMessage(chatId, `🎶 Playing preview: ${track.title} - ${track.artist.name}`);
      await bot.sendAudio(chatId, audioUrl);
    } else {
      bot.sendMessage(chatId, `❌ Song "${songQuery}" not found.`);
    }
  } catch (err) {
    console.error('Audio error:', err.message);
    bot.sendMessage(chatId, '❌ Failed to fetch audio preview.');
  }
});

// ✂️ COMMAND 3: /removebg (Reply to an image)
bot.onText(/\/removebg|\/nobg/, async (msg) => {
  const chatId = msg.chat.id;

  if (!msg.reply_to_message || !msg.reply_to_message.photo) {
    return bot.sendMessage(chatId, 'Please reply to an image with /removebg !');
  }

  bot.sendMessage(chatId, '✂️ Removing background, please wait...');

  try {
    // Get the highest resolution photo
    const photoArray = msg.reply_to_message.photo;
    const fileId = photoArray[photoArray.length - 1].file_id;
    const fileUrl = await bot.getFileLink(fileId);

    const processedBgUrl = `https://image.pollinations.ai/prompt/remove%20background%20isolated%20on%20transparent?image=${encodeURIComponent(fileUrl)}`;
    await bot.sendDocument(chatId, processedBgUrl);
  } catch (err) {
    console.error('RemoveBG error:', err.message);
    bot.sendMessage(chatId, '❌ Failed to process image background.');
  }
});
