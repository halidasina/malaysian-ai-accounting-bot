const axios = require('axios');

async function createBillplzBill(userId, plan) {
  if (!process.env.BILLPLZ_API_KEY || !process.env.BILLPLZ_COLLECTION_ID) {
    console.log('Billplz keys are not set. Returning null for mock upgrade.');
    return null;
  }
  
  // Basic: RM45 One-time + RM15/mo. First payment RM60. (6000 cents)
  // Pro: RM99 One-time + RM20/mo. First payment RM119. (11900 cents)
  const price = plan === 'basic' ? 6000 : 11900; 
  const desc = plan === 'basic' ? 'BizBook Basic (RM45 Setup + RM15 Month 1)' : 'BizBook Pro (RM99 Setup + RM20 Month 1)';

  try {
     const credentials = Buffer.from(`${process.env.BILLPLZ_API_KEY}:`).toString('base64');
     
     const res = await axios.post('https://www.billplz.com/api/v3/bills', {
        collection_id: process.env.BILLPLZ_COLLECTION_ID,
        description: desc,
        email: 'billing@bizbook.ai', // Default fallback email since TG doesnt always provide it
        name: plan.toUpperCase() + ' Sub: User ' + userId,
        amount: price,
        callback_url: (process.env.WEBHOOK_URL || 'https://localhost') + '/webhook/billplz',
        redirect_url: process.env.WEBHOOK_URL ? (process.env.WEBHOOK_URL + '/success') : '',
        reference_1_label: 'UserId_Plan',
        reference_1: `${userId}_${plan}` // Used in webhook to match user
     }, {
        headers: {
           'Authorization': `Basic ${credentials}`,
           'Content-Type': 'application/json'
        }
     });
     
     return res.data.url;
  } catch(e) {
     console.error('Billplz Create Bill Error:', e.response ? e.response.data : e.message);
     return null;
  }
}

module.exports = { createBillplzBill };
