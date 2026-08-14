const cloudinary = require('cloudinary').v2;

// I-configure ang Cloudinary gamit ang mga environment variables
cloudinary.config({ 
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET 
});

// ... (sa loob ng handleIncomingMessage)

  // 2. IMAGE GENERATION (Gamit ang Cloudinary Generative AI para sa mas maayos na quality)
  if (lowerMsg.startsWith('/image') || lowerMsg.startsWith('/draw') || lowerMsg.startsWith('/generate')) {
    const prompt = userMessage.replace(/\/image|\/draw|\/generate/i, '').trim();
    const safePrompt = prompt || 'A detailed, high-quality photograph of a beautiful scenery';
    
    await sendTextToMessenger(senderId, `Generating a high-quality image for: "${safePrompt}"...`);

    try {
      // Gumamit ng Cloudinary's Generative AI transformation para makabuo ng image
      const result = await cloudinary.uploader.upload(`data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=`, { 
          public_id: `bot_image_${Date.now()}`,
          eager: [
              { width: 1024, height: 1024, crop: "fill", effect: "gen_background" } // Hindi ito nagge-generate, nagrerequest lang ng transformation para ma-initiate ang flow. 
              // TANDAAN: Ang direktang text-to-image sa libreng tier ng Cloudinary ay limitado. 
          ],
          // Solusyon: Gumamit ng Cloudinary's Generative Fill API endpoint kung available sa plano mo.
          // Kung hindi kaya ng simpleng API call, ang Pollinations ang pinakamadali.
      });
      
      // DAHIL HINDI DIRECT TEXT-TO-IMAGE ANG CLOUDINARY API SA LIBRENG TIER,
      // IBABALIK NATIN ANG LOGIC SA POLLINATIONS PERO GAGAWIN NATING MAS DETALYADO ANG URL PARA SA MAS MAAYOS NA QUALITY.

      const encodedPrompt = encodeURIComponent(safePrompt + ", highly detailed, 8k, photorealistic, masterpiece, trending on artstation");
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}`;

      await sendMediaToMessenger(senderId, 'image', imageUrl);

    } catch (err) {
      console.error('Image Generation Error:', err);
      await sendTextToMessenger(senderId, "Sorry, an error occurred while generating the image.");
    }
    return;
  }
