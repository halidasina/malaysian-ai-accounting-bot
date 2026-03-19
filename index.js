require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// Initialize Integrations
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || 'MOCK_TOKEN');
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || 'MOCK_KEY',
});

// In-memory "database" for MVP
const DB_FILE = path.join(__dirname, 'database.json');
let db = { users: {}, transactions: [] };

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

const saveDb = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

const getUser = (id) => {
  if (!db.users[id]) {
    db.users[id] = { tier: 'free', transactionsThisMonth: 0, setupDate: new Date().toISOString() };
    saveDb();
  }
  return db.users[id];
};

// ----------------------------------------------------
// BOT COMMANDS & LOGIC
// ----------------------------------------------------

bot.start((ctx) => {
  const user = getUser(ctx.from.id);
  const welcomeMsg = `👋 Selamat datang ke BizBook! / Welcome to BizBook!\n\n` +
    `Saya ialah Bot Akauntan AI anda (Your AI Accounting Bot).\n\n` +
    `Status Akaun (Account Status): *${user.tier.toUpperCase()}*\n\n` +
    `Anda boleh:\n` +
    `1. Taip perbelanjaan (Teks untuk Free Tier)\n` +
    `2. Muat naik gambar resit (Untuk Basic/Pro Tier)\n\n` +
    `Sila hantar rekod perbelanjaan pertama anda! (e.g. "Makan tengah hari RM15")`;
  
  ctx.reply(welcomeMsg, { parse_mode: 'Markdown' });
});

bot.command('upgrade', (ctx) => {
  ctx.reply(
    '🚀 *Naik Taraf (Upgrade)*\n\nPilih pelan yang sesuai untuk perniagaan anda (Choose a plan):',
    Markup.inlineKeyboard([
      [Markup.button.callback('Free (RM0)', 'plan_free')],
      [Markup.button.callback('Basic - Resit Upload (RM15/mo)', 'plan_basic')],
      [Markup.button.callback('Pro - Unlimited (RM29/mo)', 'plan_pro')]
    ])
  );
});

bot.action(/plan_(.+)/, (ctx) => {
  const plan = ctx.match[1];
  const user = getUser(ctx.from.id);
  user.tier = plan;
  saveDb();
  ctx.reply(`✅ Akaun anda telah dinaik taraf ke pelan *${plan.toUpperCase()}*!`);
  ctx.answerCbQuery();
});

// Handle text input (Free Tier & Above)
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if(text.startsWith('/')) return; // ignore other cmds
  
  const user = getUser(ctx.from.id);
  
  // Basic Text AI extraction via logic or AI (For MVP we use AI for text too)
  ctx.reply('⏳ Sedang memproses persekitaran teks anda...');
  
  try {
    let extraction;
    
    // Check if real Anthropic Key is provided
    if (process.env.ANTHROPIC_API_KEY) {
      const response = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 300,
        system: "You are a Malaysian AI Accounting assistant. Extract the amount in RM and the category from the user's text. Respond with a strict JSON format: {\"amount\": number, \"category\": string, \"description\": string}. If no amount is found, return 0.",
        messages: [{ role: "user", content: text }]
      });
      extraction = JSON.parse(response.content[0].text);
    } else {
      // MOCK THE EXTRACTION temporarily
      extraction = {
        amount: 25.50,
        category: "Test Kategori",
        description: text
      };
    }

    db.transactions.push({ 
      userId: ctx.from.id, 
      type: 'text', 
      data: extraction, 
      date: new Date().toISOString() 
    });
    saveDb();
    
    ctx.reply(
      `✅ *Rekod Berjaya Didaftarkan*\n\n` +
      `Kategori: ${extraction.category}\n` +
      `Perbelanjaan: RM${extraction.amount}\n` +
      `Nota: ${extraction.description}`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error(error);
    ctx.reply('❌ Maaf, saya tidak dapat memahami teks anda. Sila cuba lagi dengan format (cth: "RM15 makan nasi").');
  }
});

// Handle Document/Image Uploads (Basic/Pro Tier)
bot.on(['photo', 'document'], async (ctx) => {
  const user = getUser(ctx.from.id);
  
  if (user.tier === 'free') {
    return ctx.reply('🔒 Maaf, muat naik resit (Receipt Upload) hanya tersedia untuk pelan Basic dan Pro. Sila tekan /upgrade untuk naik taraf!');
  }

  ctx.reply('⏳ Menganalisis resit anda menggunakan AI...');
  
  // NOTE: In a fully functional app, we would download the image using telegram bot API
  // and pass the base64 or buffer to Claude API's Vision feature.
  // For the MVP, we will simulate the Claude Vision API call.
  
  setTimeout(() => {
    const mockExtraction = {
      amount: 45.50,
      category: 'Makan (Food & Beverage)',
      merchant: 'Restoran Ali Maju',
      date: new Date().toISOString().split('T')[0]
    };
    
    db.transactions.push({ 
      userId: ctx.from.id, 
      type: 'receipt', 
      data: mockExtraction, 
      date: new Date().toISOString() 
    });
    saveDb();

    ctx.reply(
      `✅ *Resit Berjaya Diekstrak*\n\n` +
      `Peniaga: ${mockExtraction.merchant}\n` +
      `Kategori: ${mockExtraction.category}\n` +
      `Jumlah: RM${mockExtraction.amount}\n` +
      `Tarikh: ${mockExtraction.date}\n\n` +
      `Data telah disimpan dalam format JSON.`,
      { parse_mode: 'Markdown' }
    );
  }, 2000);
});

// Report command
bot.command('laporan', (ctx) => {
  const userTx = db.transactions.filter(t => t.userId === ctx.from.id);
  const total = userTx.reduce((sum, t) => sum + (t.data.amount || 0), 0);
  
  ctx.reply(
    `📊 *Laporan Perbelanjaan*\n\n` +
    `Jumlah Transaksi: ${userTx.length}\n` +
    `Jumlah Perbelanjaan: RM${total.toFixed(2)}\n\n` +
    `Teruskan merekod untuk laporan yang lebih tepat!`,
    { parse_mode: 'Markdown' }
  );
});

// Graceful shut down
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Launch only if tokens are provided (otherwise it's just code generated for user)
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot.launch().then(() => {
    console.log('🤖 Malaysian AI Accounting Bot MVP is running!');
  }).catch(console.error);
} else {
  console.log('Bot initialized. Please set TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY in .env file to launch.');
}

module.exports = { bot };
