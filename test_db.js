const fs = require('fs');

const db = JSON.parse(fs.readFileSync('database.json', 'utf8'));
const userId = "24838295";
const userTx = db.transactions.filter(t => String(t.userId || t.user_id) === String(userId));

console.log("Found transactions:", userTx.length);

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

console.log("incomes obj:", Object.keys(incGrp).length);
console.log("expenses obj:", Object.keys(expGrp).length);
console.log("Income groups:", incGrp);
console.log("Expense groups:", expGrp);
