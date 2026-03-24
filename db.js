const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const useSupabase = (supabaseUrl && supabaseKey);

const supabase = useSupabase ? createClient(supabaseUrl, supabaseKey) : null;

class SupabaseDB {
  async getUser(id) {
    id = String(id);
    const { data } = await supabase.from('users').select('*').eq('id', id).single();
    if (data) return data;
    const newUser = { id, tier: 'free', plan_expiry: null, setup_date: new Date().toISOString(), nudged_7_days: false };
    await supabase.from('users').insert(newUser);
    return newUser;
  }
  async saveUser(id, updates) {
    id = String(id);
    await supabase.from('users').update(updates).eq('id', id);
  }
  async addTransaction(tx) {
    tx.user_id = String(tx.userId);
    delete tx.userId;
    await supabase.from('transactions').insert(tx);
  }
  async getAllTransactions(userId) {
    userId = String(userId);
    const { data } = await supabase.from('transactions').select('*').eq('user_id', userId);
    return (data || []).map(t => ({ ...t, userId: t.user_id }));
  }
  async deleteLastTransaction(userId) {
    userId = String(userId);
    const { data } = await supabase
      .from('transactions')
      .select('id, data, date, type')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(1);
    
    if (!data || data.length === 0) return null;
    await supabase.from('transactions').delete().eq('id', data[0].id);
    return data[0];
  }
  async getAllUsers() {
    const { data } = await supabase.from('users').select('*');
    return data || [];
  }
  async isCodeUsed(code) {
    const { data } = await supabase.from('transactions').select('*').eq('type', 'one_time_code');
    return (data || []).some(t => t.data && t.data.code === code);
  }
  async markCodeUsed(code, userId) {
    await supabase.from('transactions').insert({ user_id: String(userId), type: 'one_time_code', data: { code }, date: new Date().toISOString() });
  }
}

class LocalDB {
  constructor() {
    this.dbFile = path.join(__dirname, 'database.json');
    if (fs.existsSync(this.dbFile)) {
      this.db = JSON.parse(fs.readFileSync(this.dbFile, 'utf8'));
    } else {
      this.db = { users: {}, transactions: [] };
    }
  }
  saveDb() { 
    fs.writeFileSync(this.dbFile, JSON.stringify(this.db, null, 2)); 
  }
  async getUser(id) {
    id = String(id);
    if (!this.db.users[id]) {
      this.db.users[id] = { id, tier: 'free', plan_expiry: null, setup_date: new Date().toISOString(), nudged_7_days: false };
      this.saveDb();
    }
    // Handle MVP users that don't have new fields
    const user = this.db.users[id];
    if (typeof user.nudged_7_days === 'undefined') user.nudged_7_days = user.nudged7Days || false;
    return user;
  }
  async saveUser(id, updates) {
    id = String(id);
    this.db.users[id] = { ...this.db.users[id], ...updates };
    this.saveDb();
  }
  async addTransaction(tx) {
    this.db.transactions.push({ ...tx, id: Date.now().toString(), user_id: String(tx.userId) });
    this.saveDb();
  }
  async getAllTransactions(userId) {
    userId = String(userId);
    return this.db.transactions.filter(t => String(t.userId || t.user_id) === userId);
  }
  async deleteLastTransaction(userId) {
    userId = String(userId);
    const userIndex = this.db.transactions.map(t => String(t.userId || t.user_id)).lastIndexOf(userId);
    if (userIndex === -1) return null;
    const deletedTx = this.db.transactions.splice(userIndex, 1)[0];
    this.saveDb();
    return deletedTx;
  }
  async getAllUsers() {
    return Object.values(this.db.users);
  }
  async isCodeUsed(code) {
    return this.db.transactions.some(t => t.type === 'one_time_code' && t.data && t.data.code === code);
  }
  async markCodeUsed(code, userId) {
    this.db.transactions.push({ id: Date.now().toString(), user_id: String(userId), type: 'one_time_code', data: { code }, date: new Date().toISOString() });
    this.saveDb();
  }
}

module.exports = useSupabase ? new SupabaseDB() : new LocalDB();
