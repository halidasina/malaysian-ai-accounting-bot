const cron = require('node-cron');
const { Markup } = require('telegraf');

module.exports = function(bot, dbManager) {
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
              `🔔 *Peringatan Jemputan BizBook*\n\nHi bos! Dah seminggu anda track perbelanjaan percuma bersama saya.\n\nSedar tak yang jika anda naik taraf harini, anda terus dapat kelebihan:\n📸 *Tangkap & baca gambar resit pudar* (A.I)\n📄 *Eksport dokumen P&L PDF*\n\nTekan butang di bawah untuk buka kebolehan ini pada serendah RM45 bayaran sekali + RM15 sebulan (anda pasti jimat kos daripada upah akauntan manusia)!`,
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
  // Automated 30-Day Expiry Check (Runs every day at 9:00 AM Malaysia Time)
  cron.schedule('0 9 * * *', async () => {
    console.log('🤖 Running daily 9AM expiration check...');
    const now = new Date();
    const allUsers = await dbManager.getAllUsers();
    
    for (const userData of allUsers) {
      if (userData.tier !== 'free' && userData.plan_expiry) {
        if (new Date(userData.plan_expiry) < now) {
          const userId = userData.id || userData.user_id;
          if (!userId) continue;
          
          await dbManager.saveUser(userId, { tier: 'free', plan_expiry: null });
          try {
            await bot.telegram.sendMessage(userId, 
              `⚠️ *Langganan Tamat!*\n\nPelan BizBook ${userData.tier.toUpperCase()} anda selama 30 hari telahpun tamat tempoh harini. Akaun anda kini kembali ke pelan *Percuma (Had 20 Rekod)*.\n\nSila perbaharui langganan di bawah sekarang (tanpa sebarang bayaran pendaftaran, hanya yuran bulanan)!`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [Markup.button.callback('Kekal Pelan Free', 'plan_free')],
                    [Markup.button.callback('Perbaharui Basic (RM15/bln)', 'plan_basic')],
                    [Markup.button.callback('Perbaharui Pro (RM20/bln)', 'plan_pro')]
                  ]
                }
              }
            );
            console.log(`✅ Expiration sent to User ${userId}!`);
          } catch(e) {
            console.error(`❌ Expiration notification failed for user ${userId}.`, e.message);
          }
        }
      }
    }
  }, {
    scheduled: true,
    timezone: "Asia/Kuala_Lumpur"
  });
};
