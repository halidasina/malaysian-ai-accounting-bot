const { Markup } = require('telegraf');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const path = require('path');

module.exports = function(bot, dbManager) {

// PDF Export Command (Pro Tier Only)
bot.command(['export', 'EXPORT', 'Export'], async (ctx) => {
  const user = await dbManager.getUser(ctx.from.id);
  if (user.tier !== 'pro') {
    return ctx.reply('🔒 Maaf, eksport (Export) profesional hanya tersedia untuk pelan Pro. Sila tekan /upgrade untuk naik taraf ke pelan Premium!');
  }

  // Parse arguments for duration/range filtering. e.g. /export 2026-03-01 2026-03-15
  const args = ctx.message.text.split(' ');
  let startParam = args[1];
  if (!startParam) {
    const now = new Date();
    startParam = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
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
    const dateStr = (c.data.date || c.date || new Date().toISOString()).split('T')[0];
    const baseCat = c.data.description || c.data.merchant || c.data.category || 'Lain-lain';
    const cat = `[${dateStr}] ${baseCat}`;
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
        { caption: '📄 Penyata Untung Rugi anda sudah sedia untuk rujukan Akauntan!' }
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
  let startParam = args[1];
  if (!startParam) {
    const now = new Date();
    startParam = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
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
      const dateStr = (c.data.date || c.date || new Date().toISOString()).split('T')[0];
      const baseCat = c.data.description || c.data.merchant || c.data.category || 'Lain-lain';
      const cat = `[${dateStr}] ${baseCat}`;
      let amt = 0;
      if (typeof c.data.amount === 'number') amt = c.data.amount;
      else if (typeof c.data.amount === 'string') amt = parseFloat(c.data.amount.replace(/[^0-9.-]+/g, "")) || 0;
      acc[cat] = (acc[cat] || 0) + amt;
      return acc;
  }, {});

  const incGrp = groupByCat(incomes);
  const expGrp = groupByCat(expenses);

  let totalIn = 0, totalEx = 0;
  
  const user = await dbManager.getUser(ctx.from.id);
  const monthDisplay = startParam === 'all' ? 'Sepanjang Masa' : durationText;
  let msg = `📊 *PENYATA UNTUNG RUGI (P&L)*\n`;
  msg += `Pelan Semasa: *${user.tier.toUpperCase()}*\n`;
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

};
