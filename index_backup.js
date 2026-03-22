require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { OpenAI } = require('openai');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const path = require('path');
const cron = require('node-cron');

const dbManager = require('./db');
const { createBillplzBill } = require('./billplz');

// Initialize Integrations
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || 'MOCK_TOKEN');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'MOCK_KEY',
});

// Check Expiry Middleware
bot.use(async (ctx, next) => {
  if (!ctx.from) return next();
  const user = await dbManager.getUser(ctx.from.id);
  if (user.tier !== 'free' && user.plan_expiry) {
    if (new Date(user.plan_expiry) < new Date()) {
      await dbManager.saveUser(ctx.from.id, { tier: 'free', plan_expiry: null });
      user.tier = 'free';
      try { await ctx.reply('⚠️ Langganan anda telah tamat tempoh. Akaun BizBook telah kembali ke pelan percuma. Sila tekan /upgrade untuk perbaharui.'); } catch(e) {}
    }
  }
  return next();
});


// In-memory "database" for MVP
const pendingTransactions = new Map();
// ----------------------------------------------------
// BOT COMMANDS & LOGIC
// ----------------------------------------------------

bot.start(async (ctx) => {
  const user = await dbManager.getUser(ctx.from.id);
  const expiryStr = user.plan_expiry ? '\nTarikh Tamat: ' + new Date(user.plan_expiry).toLocaleDateString('ms-MY') : '';
  const welcomeMsg = `👋 Selamat datang ke BizBook! / Welcome to BizBook!\n\n` +
    `Saya ialah Bot Akauntan AI anda (Your AI Accounting Bot).\n\n` +
    `Status Akaun (Account Status): *${user.tier.toUpperCase()}*${expiryStr}\n\n` +
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
      [Markup.button.callback('Basic - Resit Upload (RM45 One-time + RM15/mo)', 'plan_basic')],
      [Markup.button.callback('Pro - Unlimited (RM99 One-time + RM20/mo)', 'plan_pro')]
    ])
  );
});

bot.action(/plan_(.+)/, async (ctx) => {
  const plan = ctx.match[1];
  ctx.answerCbQuery();
  
  if (plan === 'free') {
    await dbManager.saveUser(ctx.from.id, { tier: 'free', plan_expiry: null });
    return ctx.reply(`✅ Akaun anda telah ditukar ke pelan *FREE*!`);
  }

  const paymentLink = await createBillplzBill(ctx.from.id, plan);
  if (paymentLink) {
    ctx.reply(`✅ Sila buat pembayaran pelan *${plan.toUpperCase()}* di pautan selamat rasmi ini:\n\n${paymentLink}`);
  } else {
    ctx.reply(`⚠️ [MOCK] Talian Billplz tak dijumpai. Akaun *${plan.toUpperCase()}* berjaya dinaik taraf (30 Hari)!`);
    await dbManager.saveUser(ctx.from.id, { 
      tier: plan, 
      plan_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  }
});

// Handle text input (Free Tier & Above)
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text;
  if(text.startsWith('/')) return next(); // pass to command handlers later in the file
  
  // Hanya proses jika ada "rm" atau sekurang-kurangnya satu nombor
  if (!/rm|\d/i.test(text)) {
    return ctx.reply('❌ Sila sertakan "RM" atau nombor (e.g. "Makan tengah hari RM15", "Toll 5").');
  }

  const user = await dbManager.getUser(ctx.from.id);
  
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
          { role: "system", content: "You are a Malaysian AI SME Accountant processing a chat message. Extract the monetary amount. ANY naked number in the text (like '10' or '15.5') is the amount in RM. Determine if it is 'income' (Pendapatan) or 'expense' (Perbelanjaan). You MUST return the 'category' strictly as either 'Pendapatan' or 'Perbelanjaan' only. Respond only with this exact JSON format: {\"amount\": number, \"category\": \"Pendapatan\" | \"Perbelanjaan\", \"description\": string, \"entryType\": \"income\" | \"expense\"}." },
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

    if (!extraction.amount || extraction.amount === 0) {
      return ctx.reply('❌ Maaf, saya tidak dapat mengesan sebarang jumlah / harga yang jelas. Sila sertakan nombor atau "RM" (Contoh: "Makan RM10" atau "Makan 10").');
    }

    const reqId = Date.now().toString() + Math.random().toString(36).substring(2, 6);
    pendingTransactions.set(reqId, { userId: ctx.from.id, type: 'text', data: extraction, date: new Date().toISOString() });
    
    ctx.reply(
      `🧐 *Sila Sahkan Transaksi*\n\n` +
      `Kategori: ${extraction.category}\n` +
      `Jumlah: RM${extraction.amount}\n` +
      `Nota: ${extraction.description || '-'}\n\n` +
      `Adakah ini Duit Masuk atau Duit Keluar?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              Markup.button.callback('📈 Pendapatan', `t_conf_income_${reqId}`),
              Markup.button.callback('📉 Perbelanjaan', `t_conf_expense_${reqId}`)
            ],
            [Markup.button.callback('❌ Batal', `t_conf_cancel_${reqId}`)]
          ]
        }
      }
    );

  } catch (error) {
    console.error(error);
    const errorMessage = error.message || error.toString();
    ctx.reply(`❌ Ralat OpenAI API (Sila periksa kunci API OpenAI anda):\n\n${errorMessage}`);
  }
});

// Handle Document/Image Uploads (Basic/Pro Tier)
bot.on(['photo', 'document'], async (ctx) => {
  const user = await dbManager.getUser(ctx.from.id);
  
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
          { role: "system", content: "You are a Malaysian AI SME Accountant. Extract details from the provided receipt or invoice image. Classify it as Income/Pendapatan (if client paid user) or Expense/Perbelanjaan (if user paid). You MUST return the 'category' strictly as either 'Pendapatan' or 'Perbelanjaan' only. Respond with strict JSON format: {\"amount\": number, \"category\": \"Pendapatan\" | \"Perbelanjaan\", \"merchant\": string, \"date\": string, \"entryType\": \"income\" | \"expense\"}. Use YYYY-MM-DD. If no value is visible, set amount to 0." },
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

    const reqId = Date.now().toString() + Math.random().toString(36).substring(2, 6);
    pendingTransactions.set(reqId, { userId: ctx.from.id, type: 'receipt', data: extraction, date: new Date().toISOString() });

    ctx.reply(
      `🧾 *Sahkan Resit A.I.*\n\n` +
      `Peniaga: ${extraction.merchant || '-'}\n` +
      `Kategori: ${extraction.category}\n` +
      `Jumlah: RM${extraction.amount}\n` +
      `Tarikh: ${extraction.date || '-'}\n\n` +
      `Sila sahkan jenis transaksi resit ini:`,
      {
         parse_mode: 'Markdown',
         reply_markup: {
           inline_keyboard: [
             [
               Markup.button.callback('📈 Pendapatan', `t_conf_income_${reqId}`), 
               Markup.button.callback('📉 Perbelanjaan', `t_conf_expense_${reqId}`)
             ],
             [Markup.button.callback('❌ Batal', `t_conf_cancel_${reqId}`)]
           ]
         }
      }
    );
  } catch (error) {
    console.error("Vision Error:", error);
    ctx.reply('❌ Ralat semasa membaca resit. Pastikan gambar jelas atau API Vision OpenAI anda dikonfigurasi dengan betul.');
  }
});

// Confirmation Callback Handler
bot.action(/t_conf_(income|expense|cancel)_(.+)/, async (ctx) => {
  const action = ctx.match[1];
  const reqId = ctx.match[2];
  ctx.answerCbQuery();

  if (action === 'cancel') {
    pendingTransactions.delete(reqId);
    return ctx.editMessageText('❌ Transaksi dibatalkan oleh pengguna.');
  }

  const pending = pendingTransactions.get(reqId);
  if (!pending) {
    return ctx.editMessageText('⚠️ Ralat: Transaksi ini telah luput atau sudah disahkan.');
  }

  // Override entrytype user strictly
  pending.data.entryType = action;
  pending.data.category = action === 'income' ? 'Pendapatan' : 'Perbelanjaan';

  await dbManager.addTransaction(pending);
  pendingTransactions.delete(reqId);

  const hType = action === 'income' ? 'Pendapatan' : 'Perbelanjaan';
  ctx.editMessageText(
      `✅ *Rekod ${hType} Disahkan & Disimpan!*\n\n` +
      `Kategori: ${pending.data.category}\n` +
      `Jumlah: RM${pending.data.amount}\n` +
      `Peniaga/Nota: ${pending.data.merchant || pending.data.description || '-'}`,
      { parse_mode: 'Markdown' }
  );
});

// Undo Command
bot.command(['undo', 'UNDO', 'Undo', 'batal'], async (ctx) => {
    const deletedTx = await dbManager.deleteLastTransaction(ctx.from.id);
    if (!deletedTx) return ctx.reply('⚠️ Tiada transaksi dijumpai untuk dipadam.');
    const hType = deletedTx.data.entryType === 'income' ? 'Pendapatan' : 'Perbelanjaan';
    const amt = deletedTx.data.amount || 0;
    const dDate = (deletedTx.data.date || deletedTx.date).split('T')[0];
    ctx.reply(`✅ *Batal Berjaya!*\nRekod ${hType} (RM${parseFloat(amt).toFixed(2)}) bertarikh ${dDate} telah sempurna dipadam dari pangkalan data.`, { parse_mode: 'Markdown' });
  });

// PDF Export Command (Pro Tier Only)
bot.command(['export', 'EXPORT', 'Export'], async (ctx) => {
  const user = await dbManager.getUser(ctx.from.id);
  if (user.tier !== 'pro') {
    return ctx.reply('🔒 Maaf, eksport (Export) profesional hanya tersedia untuk pelan Pro. Sila tekan /upgrade untuk naik taraf ke pelan Premium!');
  }

  // Parse arguments for duration/range filtering. e.g. /export 2026-03-01 2026-03-15
  const args = ctx.message.text.split(' ');
  const startParam = args[1] || new Date().toISOString().substring(0, 7); 
  const endParam = args[2] || null;

  ctx.reply(
    `📄 *Pilih Format Eksport*\nJulat Tarikh: ${startParam}${endParam ? ' hingga ' + endParam : ''}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('📕 Laporan PDF', `export_pdf_${startParam}_${endParam || 'none'}`)],
      [Markup.button.callback('📗 Laporan Excel', `export_excel_${startParam}_${endParam || 'none'}`)]
    ])
  );
});

bot.action(/export_(pdf|excel)_(.+)_(.+)/, async (ctx) => {
  const format = ctx.match[1];
  const startParam = ctx.match[2];
  const endParam = ctx.match[3] === 'none' ? null : ctx.match[3];
  ctx.answerCbQuery();
  
  let userTx = await dbManager.getAllTransactions(ctx.from.id);
  
  if (startParam !== 'all') {
    userTx = userTx.filter(t => {
       let d = (t.data.date || t.date).split('T')[0];
       // Normalize date format if OpenAI returns DD-MM-YYYY
       if (d.match(/^(\d{2})-(\d{2})-(\d{4})$/)) {
         d = d.replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$3-$2-$1");
       }
       // Normalize if DD/MM/YYYY
       if (d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)) {
         d = d.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");
       }
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

  const incomes = userTx.filter(t => t.data.entryType === 'income');
  const expenses = userTx.filter(t => t.data.entryType !== 'income');

  const groupByCat = (arr) => arr.reduce((acc, c) => {
    const dStr = (c.data.date || c.date || '').split('T')[0];
    const cat = `[${dStr}] ${c.data.description || c.data.merchant || c.data.category || 'Lain-lain'}`;
    let amt = 0;
    if (typeof c.data.amount === 'number') amt = c.data.amount;
    else if (typeof c.data.amount === 'string') amt = parseFloat(c.data.amount.replace(/[^0-9.-]+/g, "")) || 0;
    acc[cat] = (acc[cat] || 0) + amt;
    return acc;
  }, {});

  const incomeGroups = groupByCat(incomes);
  const expenseGroups = groupByCat(expenses);

  let totalIn = 0, totalEx = 0;
  for (const amt of Object.values(incomeGroups)) totalIn += amt;
  for (const amt of Object.values(expenseGroups)) totalEx += amt;

  if (format === 'pdf') {
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

    doc.fontSize(16).font('Helvetica-Bold').text('PENYATA UNTUNG RUGI (PROFIT AND LOSS)', { align: 'center', underline: true });
    doc.moveDown(2);

    doc.fontSize(12).font('Helvetica-Bold').text('PENDAPATAN (REVENUE)');
    doc.font('Helvetica');
    if (Object.keys(incomeGroups).length === 0) doc.fontSize(10).text('Tiada rekod', { indent: 20 });
    for (const [cat, amt] of Object.entries(incomeGroups)) {
      doc.fontSize(10).text(`${cat}`, { continued: true, indent: 20 }).text(`RM ${amt.toFixed(2)}`, { align: 'right' });
    }
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica-Bold').text(`JUMLAH PENDAPATAN`, { continued: true }).text(`RM ${totalIn.toFixed(2)}`, { align: 'right' });
    doc.moveDown(1.5);

    doc.fontSize(12).font('Helvetica-Bold').text('TOLAK: PERBELANJAAN (EXPENSES)');
    doc.font('Helvetica');
    if (Object.keys(expenseGroups).length === 0) doc.fontSize(10).text('Tiada rekod', { indent: 20 });
    for (const [cat, amt] of Object.entries(expenseGroups)) {
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
  } else if (format === 'excel') {
    ctx.reply('⏳ Sedang menjana Laporan Excel Profesional anda...');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BizBook AI';
    workbook.created = new Date();
    
    // Summary Sheet
    const sheet = workbook.addWorksheet('Rumusan');
    sheet.columns = [
      { header: 'Tarikh', key: 'tarikh', width: 15 },
      { header: 'Butiran', key: 'butiran', width: 40 },
      { header: 'Jumlah (RM)', key: 'jumlah', width: 20 }
    ];
    sheet.getRow(1).font = { bold: true };
    
    sheet.addRow({ tarikh: '', butiran: 'PENDAPATAN', jumlah: '' }).font = { bold: true };
    for (const [cat, amt] of Object.entries(incomeGroups)) {
      const match = cat.match(/^\[(.*?)\] (.*)$/);
      const tarikh = match ? match[1] : '';
      const butiran = match ? match[2] : cat;
      sheet.addRow({ tarikh, butiran, jumlah: amt });
    }
    sheet.addRow({ tarikh: '', butiran: 'JUMLAH PENDAPATAN', jumlah: totalIn }).font = { bold: true };
    sheet.addRow({}); // Empty row

    sheet.addRow({ tarikh: '', butiran: 'PERBELANJAAN', jumlah: '' }).font = { bold: true };
    for (const [cat, amt] of Object.entries(expenseGroups)) {
      const match = cat.match(/^\[(.*?)\] (.*)$/);
      const tarikh = match ? match[1] : '';
      const butiran = match ? match[2] : cat;
      sheet.addRow({ tarikh, butiran, jumlah: amt });
    }
    sheet.addRow({ tarikh: '', butiran: 'JUMLAH PERBELANJAAN', jumlah: totalEx }).font = { bold: true };
    sheet.addRow({});

    const untung = totalIn - totalEx;
    sheet.addRow({ tarikh: '', butiran: untung >= 0 ? 'UNTUNG BERSIH' : 'RUGI BERSIH', jumlah: untung }).font = { bold: true, color: { argb: untung >= 0 ? 'FF00FF00' : 'FFFF0000' } };
    
    // Transactions Sheet
    const txSheet = workbook.addWorksheet('Semua Transaksi');
    txSheet.columns = [
      { header: 'Tarikh', key: 'date', width: 15 },
      { header: 'Jenis', key: 'type', width: 15 },
      { header: 'Kategori', key: 'category', width: 25 },
      { header: 'Penerangan / Peniaga', key: 'desc', width: 40 },
      { header: 'Jumlah (RM)', key: 'amount', width: 15 }
    ];
    txSheet.getRow(1).font = { bold: true };

    userTx.forEach(t => {
      let amt = 0;
      if (typeof t.data.amount === 'number') amt = t.data.amount;
      else if (typeof t.data.amount === 'string') amt = parseFloat(t.data.amount.replace(/[^0-9.-]+/g, "")) || 0;
      
      txSheet.addRow({
        date: t.data.date ? t.data.date.split('T')[0] : t.date.split('T')[0],
        type: t.data.entryType === 'income' ? 'Pendapatan' : 'Perbelanjaan',
        category: t.data.category || 'Lain-lain',
        desc: t.data.description || t.data.merchant || '-',
        amount: amt
      });
    });

    const filePath = path.join(__dirname, `Laporan_${ctx.from.id}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    
    await ctx.replyWithDocument(
      { source: filePath, filename: 'Penyata_Untung_Rugi_BizBook.xlsx' },
      { caption: '📗 Laporan Excel anda sudah sedia!' }
    );
    fs.unlinkSync(filePath);
  }
});

// Report command 
bot.command(['laporan', 'LAPORAN', 'Laporan'], async (ctx) => {
  const args = ctx.message.text.split(' ');
  const startParam = args[1] || new Date().toISOString().substring(0, 7);
  const endParam = args[2] || null;

  let userTx = await dbManager.getAllTransactions(ctx.from.id);
  
  if (startParam !== 'all') {
    userTx = userTx.filter(t => {
       let d = (t.data.date || t.date).split('T')[0];
       // Normalize date format if OpenAI returns DD-MM-YYYY
       if (d.match(/^(\d{2})-(\d{2})-(\d{4})$/)) {
         d = d.replace(/^(\d{2})-(\d{2})-(\d{4})$/, "$3-$2-$1");
       }
       // Normalize if DD/MM/YYYY
       if (d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)) {
         d = d.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");
       }
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
      const dStr = (c.data.date || c.date || '').split('T')[0];
      const cat = `[${dStr}] ${c.data.description || c.data.merchant || c.data.category || 'Lain-lain'}`;
      let amt = 0;
      if (typeof c.data.amount === 'number') amt = c.data.amount;
      else if (typeof c.data.amount === 'string') amt = parseFloat(c.data.amount.replace(/[^0-9.-]+/g, "")) || 0;
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
  msg += `Tip: Taip \`/laporan YYYY-MM-DD\` untuk tarikh spesifik (Cth: /laporan 2026-03-19)`;
  
  ctx.reply(msg, { parse_mode: 'Markdown' });
});

// Graceful shut down
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

const express = require('express');
const app = express();

// Support Webhook JSON Body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/webhook/billplz', async (req, res) => {
  const { paid, state, reference_1 } = req.body;
  if (paid === 'true' || state === 'paid' || paid === true) {
     const [userId, plan] = (reference_1 || '').split('_');
     if (userId && plan) {
       await dbManager.saveUser(userId, { tier: plan, plan_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });
       
       // Generate PDF Receipt
       const doc = new PDFDocument();
       const receiptPath = path.join(__dirname, `Resit_BizBook_${userId}.pdf`);
       const stream = fs.createWriteStream(receiptPath);
       doc.pipe(stream);
       
       const amountStr = plan === 'basic' ? 'RM 60.00' : 'RM 119.00';
       const planDesc = plan === 'basic' ? 'Basic (RM45 Setup + RM15/mo)' : 'Pro (RM99 Setup + RM20/mo)';
       
       doc.fontSize(20).font('Helvetica-Bold').text('BIZBOOK - RESIT PEMBAYARAN', { align: 'center' });
       doc.moveDown();
       doc.fontSize(12).font('Helvetica').text(`Tarikh: ${new Date().toLocaleDateString('ms-MY')}`);
       doc.text(`ID Pelanggan (Telegram ID): ${userId}`);
       doc.text(`Pelan Langganan: BizBook ${plan.toUpperCase()}`);
       doc.text(`Butiran: ${planDesc}`);
       doc.moveDown();
       doc.fontSize(14).font('Helvetica-Bold').text(`Jumlah Dibayar: ${amountStr}`);
       doc.moveDown(2);
       doc.fontSize(10).font('Helvetica').text('Terima kasih kerana memilih BizBook. Ini adalah resit janaan komputer dan tiada tandatangan diperlukan.', { align: 'center' });
       
       doc.end();

       stream.on('finish', async () => {
         try { 
           await bot.telegram.sendMessage(userId, `🎉 Terima kasih! Pembayaran anda berjaya.\n\nAkaun anda telah dinaik taraf ke pelan *${plan.toUpperCase()}* sah selama 30 hari.\n\nBerikut adalah resit rasmi anda untuk rekod perniagaan. Tekan /laporan untuk lihat P&L anda!`, { parse_mode: 'Markdown' });
           await bot.telegram.sendDocument(userId, 
             { source: receiptPath, filename: `Resit_BizBook_${plan.toUpperCase()}.pdf` },
             { caption: '📄 Resit Pembayaran BizBook' }
           );
           fs.unlinkSync(receiptPath);
         } catch(e) { 
           console.error('Failed to send receipt to user:', e); 
           try { fs.unlinkSync(receiptPath); } catch(err){}
         }
       });
     }
  }
  res.send('OK');
});


app.get('/success', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Pembayaran Berjaya</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 40px 20px; background-color: #f9fafb; }
          .container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          h1 { color: #10b981; margin-bottom: 10px; }
          p { color: #4b5563; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ Pembayaran Berjaya!</h1>
          <p>Terima kasih. Langganan anda sedang diproses dan diaktifkan.</p>
          <p>Sila tutup halaman ini dan kembali ke <b>Telegram</b> untuk terus menyemak laporan P&L anda bersama BizBook.</p>
        </div>
      </body>
    </html>
  `);
});

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
  
  // Automated 7-Day Nudge Cron Job (Runs every day at 10:00 AM Malaysia Time)
  cron.schedule('0 10 * * *', async () => {
    console.log('🤖 Running daily 10AM marketing cron check...');
    const now = new Date();
    const allUsers = await dbManager.getAllUsers();
    allUsers.forEach(async (userData) => {
      const userId = userData.id || userData.user_id;
      // Check if user is free tier, has been around 7 days, and hasn't been nudged yet
      if (userData.tier === 'free' && !userData.nudged7Days && userData.setupDate) {
        const setupDate = new Date(userData.setupDate);
        const diffTime = Math.abs(now - Math.max(setupDate.getTime(), now.getTime() - (8 * 24 * 60 * 60 * 1000))); // Math fallback
        const diffDays = Math.ceil((now - setupDate) / (1000 * 60 * 60 * 24));
        
        if (diffDays >= 7) {
          try {
            await bot.telegram.sendMessage(userId, 
              `🔔 *Peringatan Jemputan BizBook*\n\nHi bos! Dah seminggu anda track perbelanjaan percuma bersama saya.\n\nSedar tak yang jika anda naik taraf harini, anda terus dapat kelebihan:\n📸 *Tangkap & baca gambar resit pudar* (A.I)\n📄 *Eksport dokumen P&L PDF LHDN*\n\nTekan butang di bawah untuk buka kebolehan ini pada serendah RM45 bayaran sekali + RM15 sebulan (anda pasti jimat kos daripada upah akauntan manusia)!`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [Markup.button.callback('😎 Buka Akses Basic (RM45 One-time + RM15/mo)', 'plan_basic')],
                    [Markup.button.callback('🚀 Buka Akses Pro (RM99 One-time + RM20/mo)', 'plan_pro')]
                  ]
                }
              }
            );
            await dbManager.saveUser(userId, { nudged_7_days: true });
            console.log(`✅ Upsell sent to User ${userId}!`);
          } catch (err) {
            console.error(`❌ Cron Nudge failed for user ${userId}. Probably blocked bot.`, err.message);
          }
        }
      }
    });
  }, {
    scheduled: true,
    timezone: "Asia/Kuala_Lumpur"
  });
  
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
