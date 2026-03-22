const { Markup } = require('telegraf');

module.exports = function(bot, openai, dbManager, pendingTransactions, createBillplzBill) {

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

bot.command('admin', async (ctx) => {
  const parts = ctx.message.text.split(' ');
  const password = parts[1];
  
  const adminPassword = process.env.ADMIN_PASSWORD || 'adminpromolife';

  if (password === adminPassword) {
    await dbManager.saveUser(ctx.from.id, { tier: 'pro', plan_expiry: new Date('2099-12-31').toISOString() });
    ctx.reply('✅ Akses Pembangun disahkan: Akaun anda kini dinaik taraf kepada PRO selamanya (Lifetime)! Sila kaji semua menu /export dan resit.');
  } else {
    ctx.reply('❌ Kata laluan salah atau tidak disertakan. Sila gunakan format: /admin <kata_laluan>');
  }
});

bot.action(/plan_(.+)/, async (ctx) => {
  const plan = ctx.match[1];
  ctx.answerCbQuery();
  
  if (plan === 'free') {
    await dbManager.saveUser(ctx.from.id, { tier: 'free', plan_expiry: null });
    return ctx.reply(`✅ Akaun anda telah ditukar ke pelan *FREE*!`);
  }

  const user = await dbManager.getUser(ctx.from.id);
  const paymentLink = await createBillplzBill(ctx.from.id, plan, user.setup_fee_paid);
  if (paymentLink) {
    const expectedCost = user.setup_fee_paid ? (plan === 'basic' ? 'RM15' : 'RM20') : (plan === 'basic' ? 'RM60' : 'RM119');
    ctx.reply(`✅ Sila buat pembayaran pelan *${plan.toUpperCase()}* (${expectedCost}) di pautan selamat rasmi ini:\n\n${paymentLink}`);
  } else {
    ctx.reply(`⚠️ [MOCK] Talian Billplz tak dijumpai. Akaun *${plan.toUpperCase()}* berjaya dinaik taraf (30 Hari)!`);
    await dbManager.saveUser(ctx.from.id, { 
      tier: plan, 
      plan_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      setup_fee_paid: true
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

};
