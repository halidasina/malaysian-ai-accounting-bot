const axios = require('axios');

async function createBillplzBill(userId, plan, setupFeePaid = false) {
  if (!process.env.BILLPLZ_API_KEY || !process.env.BILLPLZ_COLLECTION_ID) {
    console.log('Billplz keys are not set. Returning null for mock upgrade.');
    return null;
  }
  
  let price, desc;
  if (plan === 'basic') {
    price = setupFeePaid ? 1500 : 6000;
    desc = setupFeePaid ? 'BizBook Basic Renewal (RM15 Monthly)' : 'BizBook Basic (RM45 Setup + RM15 Month 1)';
  } else {
    price = setupFeePaid ? 2000 : 11900;
    desc = setupFeePaid ? 'BizBook Pro Renewal (RM20 Monthly)' : 'BizBook Pro (RM99 Setup + RM20 Month 1)';
  }

  try {
     const credentials = Buffer.from(`${process.env.BILLPLZ_API_KEY}:`).toString('base64');
     
     const res = await axios.post('https://www.billplz.com/api/v3/bills', {
        collection_id: process.env.BILLPLZ_COLLECTION_ID,
        description: desc,
        email: 'billing@bizbook.ai', // Default fallback email since TG doesnt always provide it
        name: plan.toUpperCase() + ' Sub: User ' + userId,
        amount: price,
        callback_url: (process.env.WEBHOOK_URL || 'https://localhost') + `/webhook/billplz/${userId}/${plan}`,
        redirect_url: process.env.WEBHOOK_URL ? (process.env.WEBHOOK_URL + '/success') : '',
        reference_1_label: 'UserId_Plan',
        reference_1: `${userId}_${plan}` // Just for dashboard logging now
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
