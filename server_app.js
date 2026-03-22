const express = require('express');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');

module.exports = function(bot, dbManager) {
  const app = express();

  // Support Webhook JSON Body
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.post('/webhook/billplz', async (req, res) => {
    const { paid, state, reference_1, amount } = req.body;
    if (paid === 'true' || state === 'paid' || paid === true) {
       const [userId, plan] = (reference_1 || '').split('_');
       if (userId && plan) {
         await dbManager.saveUser(userId, { tier: plan, plan_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), setup_fee_paid: true });
         
         // Generate PDF Receipt
         const doc = new PDFDocument();
         const receiptPath = path.join(__dirname, `Resit_BizBook_${userId}.pdf`);
         const stream = fs.createWriteStream(receiptPath);
         doc.pipe(stream);
         
         const paidAmount = amount ? (parseInt(amount) / 100) : (plan === 'basic' ? 60 : 119);
         const amountStr = `RM ${paidAmount.toFixed(2)}`;
         const planDesc = paidAmount > 30 ? (plan === 'basic' ? 'Basic (RM45 Setup + RM15/mo)' : 'Pro (RM99 Setup + RM20/mo)') : (plan === 'basic' ? 'Basic (RM15 Renewal)' : 'Pro (RM20 Renewal)');
         
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

  return app;
};
