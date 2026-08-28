async function processIncomingMessage(senderId, messageObj) {
  const text = messageObj.text ? messageObj.text.trim() : '';
  let fileUrl = null;
  let fileType = null;

  // 1. Direct attachment sa mismong message
  if (messageObj.attachments && messageObj.attachments[0]) {
    fileUrl = messageObj.attachments[0].payload?.url;
    fileType = messageObj.attachments[0].type;
  }

  // 2. Kapag REPLIED MESSAGE (reply sa lumang larawan)
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

  // COMMAND: /topdf o /pdf
  if (low.startsWith('/topdf') || low.startsWith('/pdf')) {
    await handleConvertToPdf(senderId, fileUrl, fileType, text);
    return;
  }

  // KAPAG NAG-SEND NG PIC NA WALANG TEXT O MAY KASAMANG /removebg
  if (fileUrl && fileType === 'image' && (low.startsWith('/removebg') || low.startsWith('/bgremove') || text === '')) {
    await handleRemoveBg(senderId, fileUrl);
    return;
  }

  if (low.startsWith('/removebg') || low.startsWith('/bgremove')) {
    await handleRemoveBg(senderId, fileUrl);
    return;
  }

  handleMsg(senderId, text, fileUrl);
}

// Inayos na PDF handler
async function handleConvertToPdf(senderId, fileUrl, fileType, text) {
  const contentText = text.replace(/\/topdf|\/pdf/i, '').trim();

  // Kung may nahanap na image URL (maging direct upload o replied message)
  if (fileUrl && (fileType === 'image' || fileUrl.includes('.jpg') || fileUrl.includes('.png') || fileUrl.includes('fbcdn'))) {
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

  // Kung text lang ang ipinadala kasama ng /topdf
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
