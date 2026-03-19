require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { OpenAI } = require('openai');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

// Initialize Integrations
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || 'MOCK_TOKEN');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'MOCK_KEY',
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
    `1. Taip perbelanjaan / pendapatan\n` +
    `2. Muat naik gambar resit (Basic/Pro Tier)\n\n` +
    `Perintah / Menu Berguna:\n` +
    `🧮 /laporan - Lihat Penyata P&L semasa\n` +
    `📄 /export - Muat turun dokumen PDF rasmi\n` +
    `🔙 /undo - Batal pendaftaran terakhir\n` +
    `🚀 /upgrade - Naik taraf pelan akaun anda\n\n` +
    `Sila hantar rekod perbelanjaan pertama anda! (e.g. "Makan tengah hari RM15")`;
  
  ctx.reply(welcomeMsg, { parse_mode: 'Markdown' });
});

bot.command(['upgrade', 'UPGRADE', 'Upgrade'], (ctx) => {
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
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text;
  if(text.startsWith('/')) return next(); // pass to command handlers later in the file
  
  // Hanya proses jika ada "rm" atau sekurang-kurangnya satu nombor
  if (!/rm|\d/i.test(text)) {
    return ctx.reply('❌ Sila sertakan "RM" atau nombor (e.g. "Makan tengah hari RM15", "Toll 5").');
  }

  const user = getUser(ctx.from.id);
  
  // Basic Text AI extraction via logic or AI (For MVP we use AI for text too)
  ctx.reply('⏳ Sekejap bos, tengah kira-kira ni...');
  
  try {
    let extraction;
    
    // Check if real OpenAI Key is provided
    if (process.env.OPENAI_API_KEY) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a Malaysian AI SME Accountant. Extract details from the user's text. Determine if it is Income (Pendapatan) or Expense (Perbelanjaan). Respond with strict JSON format: {\"amount\": number, \"category\": string, \"description\": string, \"entryType\": \"income\" | \"expense\"}. If no amount is found, return 0." },
          { role: "user", content: text }
        ]
      });
      extraction = JSON.parse(response.choices[0].message.content);
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
    
    const hType = extraction.entryType === 'income' ? 'Pendapatan' : 'Perbelanjaan';
    ctx.reply(
      `✅ *Rekod ${hType} Berjaya*\n\n` +
      `Kategori: ${extraction.category}\n` +
      `Jumlah: RM${extraction.amount}\n` +
      `Nota: ${extraction.description}`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error(error);
    const errorMessage = error.message || error.toString();
    ctx.reply(`❌ Ralat OpenAI API (Sila periksa kunci API OpenAI anda):\n\n${errorMessage}`);
  }
});

// Handle Document/Image Uploads (Basic/Pro Tier)
bot.on(['photo', 'document'], async (ctx) => {
  const user = getUser(ctx.from.id);
  
  if (user.tier === 'free') {
    return ctx.reply('🔒 Maaf, muat naik resit (Receipt Upload) hanya tersedia untuk pelan Basic dan Pro. Sila tekan /upgrade untuk naik taraf!');
  }

  try {
    let fileId;
    if (ctx.message.photo) {
      fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
    } else if (ctx.message.document) {
      fileId = ctx.message.document.file_id;
    }

    if (!fileId) throw new Error("Tiada fail sah dijumpai.");
    const fileUrl = await ctx.telegram.getFileLink(fileId);

    ctx.reply('⏳ Sedang membaca dan menganalisis resit anda...');

    let extraction;
    if (process.env.OPENAI_API_KEY) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You are a Malaysian AI SME Accountant. Extract details from the provided receipt or invoice image. Classify it as Income/Pendapatan (if client paid user) or Expense/Perbelanjaan (if user paid). Respond with strict JSON format: {\"amount\": number, \"category\": string, \"merchant\": string, \"date\": string, \"entryType\": \"income\" | \"expense\"}. Use YYYY-MM-DD. If no value is visible, set amount to 0." },
          { role: "user", content: [
            { type: "text", text: "Parse this receipt/document." },
            { type: "image_url", image_url: { url: fileUrl.href } }
          ]}
        ]
      });
      extraction = JSON.parse(response.choices[0].message.content);
    } else {
      extraction = { amount: 45.50, category: 'Makan', merchant: 'Restoran Ali Maju Mock', date: new Date().toISOString().split('T')[0] };
    }

    if (!extraction.amount || extraction.amount === 0) {
      return ctx.reply('❌ Maaf, saya tidak dapat mengesan sebarang jumlah / harga pada gambar ini. Sila pastikan gambar ini adalah resit yang sah dan jumlah bayaran kelihatan dengan jelas.');
    }

    db.transactions.push({ userId: ctx.from.id, type: 'receipt', data: extraction, date: new Date().toISOString() });
    saveDb();

    const pHType = extraction.entryType === 'income' ? 'Pendapatan' : 'Perbelanjaan';
    ctx.reply(
      `✅ *Resit ${pHType} Diekstrak*\n\n` +
      `Peniaga/Klien: ${extraction.merchant}\n` +
      `Kategori: ${extraction.category}\n` +
      `Jumlah: RM${extraction.amount}\n` +
      `Tarikh: ${extraction.date}\n\n` +
      `Rekod ini telah disimpan dengan selamat! 🧾👍`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error("Vision Error:", error);
    ctx.reply('❌ Ralat semasa membaca resit. Pastikan gambar jelas atau API Vision OpenAI anda dikonfigurasi dengan betul.');
  }
});

// Undo Command
bot.command(['undo', 'UNDO', 'Undo', 'batal'], (ctx) => {
  const userIndex = db.transactions.map(t => t.userId).lastIndexOf(ctx.from.id);
  if (userIndex === -1) {
    return ctx.reply('⚠️ Tiada transaksi dijumpai untuk dipadam.');
  }
  const deletedTx = db.transactions.splice(userIndex, 1)[0];
  saveDb();
  
  const hType = deletedTx.data.entryType === 'income' ? 'Pendapatan' : 'Perbelanjaan';
  const amt = deletedTx.data.amount || 0;
  const dDate = (deletedTx.data.date || deletedTx.date).split('T')[0];
  ctx.reply(`✅ *Batal Berjaya!*\nRekod ${hType} (RM${amt.toFixed(2)}) bertarikh ${dDate} telah sempurna dipadam dari pangkalan data.`, { parse_mode: 'Markdown' });
});

// PDF Export Command (Pro Tier Only)
bot.command(['export', 'EXPORT', 'Export'], async (ctx) => {
  const user = getUser(ctx.from.id);
  if (user.tier !== 'pro') {
    return ctx.reply('🔒 Maaf, eksport PDF (PDF Export) profesional hanya tersedia untuk pelan Pro. Sila tekan /upgrade untuk naik taraf ke pelan Premium!');
  }

  // Parse arguments for duration/range filtering. e.g. /export 2026-03-01 2026-03-15
  const args = ctx.message.text.split(' ');
  const startParam = args[1] || new Date().toISOString().substring(0, 7); 
  const endParam = args[2] || null;

  let userTx = db.transactions.filter(t => t.userId === ctx.from.id);
  
  if (startParam !== 'all') {
    userTx = userTx.filter(t => {
       const d = (t.data.date || t.date).split('T')[0];
       if (endParam) {
           return d >= startParam && d <= endParam;
       }
       return d.startsWith(startParam);
    });
  }

  const durationText = endParam ? `${startParam} hingga ${endParam}` : startParam;

  if (userTx.length === 0) {
    return ctx.reply(`⚠️ Tiada transaksi dijumpai untuk julat tarikh: ${durationText}. Cuba '/export all'`);
  }

  ctx.reply('⏳ Sedang menjana Laporan PDF Profesional anda...');

  const doc = new PDFDocument();
  const filePath = path.join(__dirname, `Laporan_${ctx.from.id}.pdf`);
  const stream = fs.createWriteStream(filePath);
  
  doc.pipe(stream);
  
  doc.fontSize(20).text('BizBook - Laporan Perbelanjaan', { align: 'center' });
  doc.moveDown();
  doc.fontSize(12).text(`Bulan/Tempoh: ${startParam === 'all' ? 'Keseluruhan Masa' : durationText}`);
  doc.text(`Tarikh Sedia: ${new Date().toLocaleDateString('ms-MY')}`);
  doc.text(`ID Pelanggan (VIP): ${ctx.from.username || ctx.from.id}`);
  doc.moveDown();

  const incomes = userTx.filter(t => t.data.entryType === 'income');
  const expenses = userTx.filter(t => t.data.entryType !== 'income');

  const groupByCat = (arr) => arr.reduce((acc, c) => {
    const cat = c.data.category || 'Lain-lain';
    const amt = typeof c.data.amount === 'number' ? c.data.amount : 0;
    acc[cat] = (acc[cat] || 0) + amt;
    return acc;
  }, {});

  const incomeGroups = groupByCat(incomes);
  const expenseGroups = groupByCat(expenses);

  let totalIn = 0, totalEx = 0;

  doc.fontSize(16).font('Helvetica-Bold').text('PENYATA UNTUNG RUGI (PROFIT AND LOSS)', { align: 'center', underline: true });
  doc.moveDown(2);

  doc.fontSize(12).font('Helvetica-Bold').text('PENDAPATAN (REVENUE)');
  doc.font('Helvetica');
  if (Object.keys(incomeGroups).length === 0) doc.fontSize(10).text('Tiada rekod', { indent: 20 });
  for (const [cat, amt] of Object.entries(incomeGroups)) {
    totalIn += amt;
    doc.fontSize(10).text(`${cat}`, { continued: true, indent: 20 }).text(`RM ${amt.toFixed(2)}`, { align: 'right' });
  }
  doc.moveDown(0.5);
  doc.fontSize(11).font('Helvetica-Bold').text(`JUMLAH PENDAPATAN`, { continued: true }).text(`RM ${totalIn.toFixed(2)}`, { align: 'right' });
  doc.moveDown(1.5);

  doc.fontSize(12).font('Helvetica-Bold').text('TOLAK: PERBELANJAAN (EXPENSES)');
  doc.font('Helvetica');
  if (Object.keys(expenseGroups).length === 0) doc.fontSize(10).text('Tiada rekod', { indent: 20 });
  for (const [cat, amt] of Object.entries(expenseGroups)) {
    totalEx += amt;
    doc.fontSize(10).text(`${cat}`, { continued: true, indent: 20 }).text(`RM ${amt.toFixed(2)}`, { align: 'right' });
  }
  doc.moveDown(0.5);
  doc.fontSize(11).font('Helvetica-Bold').text(`JUMLAH PERBELANJAAN`, { continued: true }).text(`RM ${totalEx.toFixed(2)}`, { align: 'right' });
  doc.moveDown(2);
  
  const untung = totalIn - totalEx;
  const label = untung >= 0 ? 'UNTUNG BERSIH (NET PROFIT)' : 'RUGI BERSIH (NET LOSS)';
  doc.fontSize(14).font('Helvetica-Bold').text(`${label}`, { continued: true }).text(`RM ${untung.toFixed(2)}`, { align: 'right' });
  
  doc.end();

  stream.on('finish', async () => {
    await ctx.replyWithDocument(
      { source: filePath, filename: 'Penyata_Untung_Rugi_BizBook.pdf' },
      { caption: '📄 Penyata Untung Rugi anda sudah sedia untuk rujukan Akauntan/LHDN!' }
    );
    fs.unlinkSync(filePath); // cleanup
  });
});

// Report command 
bot.command(['laporan', 'LAPORAN', 'Laporan'], (ctx) => {
  const args = ctx.message.text.split(' ');
  const startParam = args[1] || new Date().toISOString().substring(0, 7);
  const endParam = args[2] || null;

  let userTx = db.transactions.filter(t => t.userId === ctx.from.id);
  
  if (startParam !== 'all') {
    userTx = userTx.filter(t => {
       const d = (t.data.date || t.date).split('T')[0];
       if (endParam) {
           return d >= startParam && d <= endParam;
       }
       return d.startsWith(startParam);
    });
  }
  
  const durationText = endParam ? `${startParam} hingga ${endParam}` : startParam;
  const incomes = userTx.filter(t => t.data.entryType === 'income');
  const expenses = userTx.filter(t => t.data.entryType !== 'income');
  
  const groupByCat = (arr) => arr.reduce((acc, c) => {
      const cat = c.data.category || 'Lain-lain';
      const amt = typeof c.data.amount === 'number' ? c.data.amount : 0;
      acc[cat] = (acc[cat] || 0) + amt;
      return acc;
  }, {});

  const incGrp = groupByCat(incomes);
  const expGrp = groupByCat(expenses);

  let totalIn = 0, totalEx = 0;
  
  const monthDisplay = startParam === 'all' ? 'Sepanjang Masa' : durationText;
  let msg = `📊 *PENYATA UNTUNG RUGI (P&L)*\n`;
  msg += `Julat Tarikh: ${monthDisplay}\n\n`;
  
  msg += `*PENDAPATAN*\n`;
  for(const [c, a] of Object.entries(incGrp)) { msg += `- ${c}: RM${a.toFixed(2)}\n`; totalIn += a; }
  if(totalIn === 0) msg += `- Tiada rekod\n`;
  msg += `*Jumlah Pendapatan: RM${totalIn.toFixed(2)}*\n\n`;

  msg += `*TOLAK: PERBELANJAAN*\n`;
  for(const [c, a] of Object.entries(expGrp)) { msg += `- ${c}: RM${a.toFixed(2)}\n`; totalEx += a; }
  if(totalEx === 0) msg += `- Tiada rekod\n`;
  msg += `*Jumlah Perbelanjaan: RM${totalEx.toFixed(2)}*\n\n`;

  const untung = totalIn - totalEx;
  const status = untung >= 0 ? '📈 UNTUNG' : '📉 RUGI';
  
  msg += `---------------------------\n`;
  msg += `*${status} BERSIH: RM${Math.abs(untung).toFixed(2)}*\n\n`;
  msg += `Tip: Taip /export untuk muat turun Penyata rasmi PDF.`;
  
  ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Graceful shut down
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('Malaysian AI Accounting Bot MVP is running!');
});

const PORT = process.env.PORT || 3000;

// Launch only if tokens are provided
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot.launch().catch(console.error);
} else {
  console.log('Bot initialized but missing TELEGRAM_BOT_TOKEN in .env. It will not listen to Telegram.');
}

app.listen(PORT, async () => {
  console.log(`🤖 Express Web Server listening on port ${PORT}`);
  
  if (process.env.TELEGRAM_BOT_TOKEN) {
    bot.telegram.setMyCommands([
      { command: 'start', description: 'Mula sistem BizBook' },
      { command: 'laporan', description: 'Penyata Untung Rugi Bulanan (P&L)' },
      { command: 'export', description: 'Cetak Laporan PDF LHDN (Pro)' },
      { command: 'undo', description: 'Padam pendaftaran rekod terakhir' },
      { command: 'upgrade', description: 'Pilih pelan langganan' }
    ]).catch(console.error);
    console.log('✅ Native Telegram commands menu synchronized.');
  }

  console.log('🤖 Malaysian AI Accounting Bot MVP is now online!');
});

module.exports = { bot, app };
