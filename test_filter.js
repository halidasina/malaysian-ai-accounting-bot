const fs = require('fs');

const db = JSON.parse(fs.readFileSync('database.json', 'utf8'));
const userId = "24838295"; // A user with transactions in db
let userTx = db.transactions.filter(t => String(t.userId || t.user_id) === String(userId));

console.log("Total user transactions:", userTx.length);

// Apply laporan filtering logic
const startParam = "2026-03";
const endParam = null;

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

console.log("Transactions matching startParam " + startParam + ":", userTx.length);
