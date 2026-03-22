const dbManager = require('./db');
const { Telegraf } = require('telegraf');
const bot = new Telegraf('MOCK_TOKEN');

// Mock a ctx object for /laporan
const ctx = {
  from: { id: 123456 }, // Assumes test user ID or we will just print what would be responded
  message: { text: '/laporan all' },
  reply: (msg) => { console.log("---- LAPORAN REPLY ----\n", msg); }
};

require('./reports_handlers')(bot, dbManager);

// Manually trigger the bot command 'laporan'
async function run() {
  // Let's add a fake transaction to make sure it prints
  await dbManager.addTransaction({
    userId: 123456,
    type: 'text',
    date: new Date().toISOString(),
    data: { amount: 100, category: 'Pendapatan', description: 'Test Pendapatan', entryType: 'income' }
  });
  
  // Find the laporan handler and run it
  // Actually, we can just simulate the event on the bot if it was launched, but it's not.
  // We can just invoke the handler directly.
  bot.handleUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 123456, is_bot: false, first_name: 'Test' },
      chat: { id: 123456, type: 'private' },
      date: Date.now(),
      text: '/laporan all'
    }
  });
}

// Since handleUpdate triggers ctx.reply but we can't easily capture it unless we mock bot.context
bot.context.reply = (msg) => { console.log("---- LAPORAN REPLY ----\n", msg); };

run().catch(console.error);
