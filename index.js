require('dotenv').config();
const { Telegraf } = require('telegraf');
const { OpenAI } = require('openai');

const dbManager = require('./db');
const { createBillplzBill } = require('./billplz');

// Initialize Integrations
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN || 'MOCK_TOKEN');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'MOCK_KEY',
});

// In-memory "database" for MVP
const pendingTransactions = new Map();

// ----------------------------------------------------
// MODULAR COMPONENT REGISTRATION
// ----------------------------------------------------

// 1. Bot Handlers (Middleware, AI Extraction, Telegram Logic)
require('./bot_handlers')(bot, openai, dbManager, pendingTransactions, createBillplzBill);

// 2. Report Handlers (PDF, Excel, Laporan)
require('./reports_handlers')(bot, dbManager);

// 3. Express Web Server (Webhooks, API)
const app = require('./server_app')(bot, dbManager);

// Graceful shut down
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

const PORT = process.env.PORT || 3000;

// Launch only if tokens are provided
if (process.env.TELEGRAM_BOT_TOKEN) {
  bot.launch().catch(console.error);
} else {
  console.log('Bot initialized but missing TELEGRAM_BOT_TOKEN in .env. It will not listen to Telegram.');
}

app.listen(PORT, async () => {
  console.log(`🤖 Express Web Server listening on port ${PORT}`);
  
  // 4. Cron Jobs (Daily marketing nudge)
  require('./cron_jobs')(bot, dbManager);

  // Setup Commands UI in Telegram Client
  if (process.env.TELEGRAM_BOT_TOKEN) {
    bot.telegram.setMyCommands([
      { command: 'start', description: 'Mula sistem BizBook' },
      { command: 'laporan', description: 'Penyata Untung Rugi Bulanan (P&L)' },
      { command: 'laporan_all', description: 'Penyata Keseluruhan Masa' },
      { command: 'export', description: 'Cetak Laporan PDF (Pro)' },
      { command: 'undo', description: 'Padam pendaftaran rekod terakhir' },
      { command: 'upgrade', description: 'Pilih pelan langganan' },
      { command: 'help', description: 'Bantuan & Hubungi Admin' }
    ]).catch(console.error);
    console.log('✅ Native Telegram commands menu synchronized.');
  }

  console.log('🤖 Malaysian AI Accounting Bot MVP is now online!');
});

module.exports = { bot, app };
