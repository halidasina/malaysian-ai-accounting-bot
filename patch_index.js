const fs = require('fs');

try {
  let content = fs.readFileSync('index.js', 'utf8');

  // 1. imports
  content = content.replace(
    `// Initialize Integrations`,
    `const dbManager = require('./db');\nconst { createBillplzBill } = require('./billplz');\n\n// Initialize Integrations`
  );

  // Add Expiry Check Middleware directly after bot initialization
  content = content.replace(
    `const openai = new OpenAI({\n  apiKey: process.env.OPENAI_API_KEY || 'MOCK_KEY',\n});`,
    `const openai = new OpenAI({\n  apiKey: process.env.OPENAI_API_KEY || 'MOCK_KEY',\n});\n\n// Check Expiry Middleware\nbot.use(async (ctx, next) => {\n  if (!ctx.from) return next();\n  const user = await dbManager.getUser(ctx.from.id);\n  if (user.tier !== 'free' && user.plan_expiry) {\n    if (new Date(user.plan_expiry) < new Date()) {\n      await dbManager.saveUser(ctx.from.id, { tier: 'free', plan_expiry: null });\n      user.tier = 'free';\n      try { await ctx.reply('⚠️ Langganan anda telah tamat tempoh. Akaun BizBook telah kembali ke pelan percuma. Sila tekan /upgrade untuk perbaharui.'); } catch(e) {}\n    }\n  }\n  return next();\n});\n`
  );

  // 2. remove DB_FILE block
  content = content.replace(
    /const DB_FILE = path\.join\(__dirname, 'database\.json'\);\nlet db = \{ users: \{\}, transactions: \[\] \};\n\nif \(fs\.existsSync\(DB_FILE\)\) \{\n  db = JSON\.parse\(fs\.readFileSync\(DB_FILE, 'utf8'\)\);\n\}\n\nconst saveDb = \(\) => fs\.writeFileSync\(DB_FILE, JSON\.stringify\(db, null, 2\)\);\n\nconst getUser = \(id\) => \{\n  if \(\!db\.users\[id\]\) \{\n    db\.users\[id\] = \{ tier: 'free', transactionsThisMonth: 0, setupDate: new Date\(\)\.toISOString\(\) \};\n    saveDb\(\);\n  \}\n  return db\.users\[id\];\n\};\n\n/g,
    ``
  );

  // 3. bot.start
  content = content.replace(
    `bot.start((ctx) => {`,
    `bot.start(async (ctx) => {`
  );
  content = content.replace(
    `const user = getUser(ctx.from.id);`,
    `const user = await dbManager.getUser(ctx.from.id);\n  const expiryStr = user.plan_expiry ? '\\nTarikh Tamat: ' + new Date(user.plan_expiry).toLocaleDateString('ms-MY') : '';`
  );
  content = content.replace(
    /Status Akaun \(Account Status\): \*\$\{user\.tier\.toUpperCase\(\)\}\*/,
    `Status Akaun (Account Status): *\${user.tier.toUpperCase()}*\${expiryStr}`
  );

  // 4. modify action /plan
  content = content.replace(
    /bot\.action\(\/plan_\(\.\+\)\/, \(ctx\) => \{\n  const plan = ctx\.match\[1\];\n  const user = getUser\(ctx\.from\.id\);\n  user\.tier = plan;\n  saveDb\(\);\n  ctx\.reply\(`✅ Akaun anda telah dinaik taraf ke pelan \*\$\{plan\.toUpperCase\(\)\}\*!`\);\n  ctx\.answerCbQuery\(\);\n\}\);/g,
    `bot.action(/plan_(.+)/, async (ctx) => {
  const plan = ctx.match[1];
  ctx.answerCbQuery();
  
  if (plan === 'free') {
    await dbManager.saveUser(ctx.from.id, { tier: 'free', plan_expiry: null });
    return ctx.reply(\`✅ Akaun anda telah ditukar ke pelan *FREE*!\`);
  }

  const paymentLink = await createBillplzBill(ctx.from.id, plan);
  if (paymentLink) {
    ctx.reply(\`✅ Sila buat pembayaran pelan *\${plan.toUpperCase()}* di pautan selamat rasmi ini:\\n\\n\${paymentLink}\`);
  } else {
    ctx.reply(\`⚠️ [MOCK] Talian Billplz tak dijumpai. Akaun *\${plan.toUpperCase()}* berjaya dinaik taraf (30 Hari)!\`);
    await dbManager.saveUser(ctx.from.id, { 
      tier: plan, 
      plan_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  }
});`
  );

  // 5. User fetch
  content = content.replace(/const user = getUser\(ctx\.from\.id\);/g, `const user = await dbManager.getUser(ctx.from.id);`);

  // 6. transactions mapping
  content = content.replace(
    /db\.transactions\.push\(\{ \n      userId: ctx\.from\.id, \n      type: 'text', \n      data: extraction, \n      date: new Date\(\)\.toISOString\(\) \n    \}\);\n    saveDb\(\);/g, 
    `await dbManager.addTransaction({ userId: ctx.from.id, type: 'text', data: extraction, date: new Date().toISOString() });`
  );

  content = content.replace(
    /db\.transactions\.push\(\{ userId: ctx\.from\.id, type: 'receipt', data: extraction, date: new Date\(\)\.toISOString\(\) \}\);\n    saveDb\(\);/g, 
    `await dbManager.addTransaction({ userId: ctx.from.id, type: 'receipt', data: extraction, date: new Date().toISOString() });`
  );

  // 7. undo
  content = content.replace(/bot\.command\(\['undo', 'UNDO', 'Undo', 'batal'\], \(ctx\) => \{[\s\S]*?ctx\.reply\(`✅ \*Batal Berjaya!\*\\nRekod \$\{hType\} \(RM\$\{amt\.toFixed\(2\)\}\) bertarikh \$\{dDate\} telah sempurna dipadam dari pangkalan data\.`, \{ parse_mode: 'Markdown' \}\);\n\}\);/g, 
  `bot.command(['undo', 'UNDO', 'Undo', 'batal'], async (ctx) => {
    const deletedTx = await dbManager.deleteLastTransaction(ctx.from.id);
    if (!deletedTx) return ctx.reply('⚠️ Tiada transaksi dijumpai untuk dipadam.');
    const hType = deletedTx.data.entryType === 'income' ? 'Pendapatan' : 'Perbelanjaan';
    const amt = deletedTx.data.amount || 0;
    const dDate = (deletedTx.data.date || deletedTx.date).split('T')[0];
    ctx.reply(\`✅ *Batal Berjaya!*\\nRekod \${hType} (RM\${parseFloat(amt).toFixed(2)}) bertarikh \${dDate} telah sempurna dipadam dari pangkalan data.\`, { parse_mode: 'Markdown' });
  });`);

  // 8. laporan parsing
  content = content.replace(/bot\.command\(\['laporan', 'LAPORAN', 'Laporan'\], \(ctx\) => \{/g, `bot.command(['laporan', 'LAPORAN', 'Laporan'], async (ctx) => {`);
  content = content.replace(/let userTx = db\.transactions\.filter\(t => t\.userId === ctx\.from\.id\);/g, `let userTx = await dbManager.getAllTransactions(ctx.from.id);`);

  // 9. Webhook endpoint
  content = content.replace(
    `const app = express();`,
    `const app = express();\n\n// Support Webhook JSON Body\napp.use(express.json());\napp.use(express.urlencoded({ extended: true }));\n\napp.post('/webhook/billplz', async (req, res) => {\n  const { paid, state, reference_1 } = req.body;\n  if (paid === 'true' || state === 'paid' || paid === true) {\n     const [userId, plan] = (reference_1 || '').split('_');\n     if (userId && plan) {\n       await dbManager.saveUser(userId, { tier: plan, plan_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() });\n       try { await bot.telegram.sendMessage(userId, \`🎉 Terima kasih! Pembayaran anda berjaya.\\n\\nAkaun anda telah dinaik taraf ke pelan *\${plan.toUpperCase()}* sah selama 30 hari.\\n\\n/laporan untuk lihat P&L anda!\`, { parse_mode: 'Markdown' }); } catch(e) { console.error(e); }\n     }\n  }\n  res.send('OK');\n});\n`
  );

  // 10. Cronjob fixing foreach Object.keys
  content = content.replace(
    /Object\.entries\(db\.users\)\.forEach\(async \(\[userId, userData\]\) => \{/g,
    `const allUsers = await dbManager.getAllUsers();\n    allUsers.forEach(async (userData) => {\n      const userId = userData.id || userData.user_id;`
  );
  content = content.replace(`userData.nudged7Days = true;\n            saveDb();`, `await dbManager.saveUser(userId, { nudged_7_days: true });`);

  fs.writeFileSync('new_index.js', content);
  console.log("SUCCESS");
} catch(e) {
  console.log("ERROR", e.message);
}
