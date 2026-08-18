const mongoose = require('mongoose');

// MongoDB URI from the user (appending bills_automation database name)
const MONGO_URI = 'mongodb+srv://achrafwebsite:0iotqR497aDmh6M2@cluster0.3uayczk.mongodb.net/bills_automation?retryWrites=true&w=majority&appName=Cluster0f';

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas (bills_automation)'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- Schemas ---

const billSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  invoice_number: { type: String },
  amount: { type: Number, required: true },
  billing_period: { type: String },
  consumption: { type: String },
  due_date: { type: String },
  payment_url: { type: String },
  payment_code: { type: String },
  status: { type: String, default: 'unpaid' },
  pdf_path: { type: String },
  raw_data: { type: String },
  scraped_at: { type: Date, default: Date.now }
});

// Compound unique index mimicking SQLite UNIQUE(provider, billing_period)
billSchema.index({ provider: 1, billing_period: 1 }, { unique: true });

const scrapeLogSchema = new mongoose.Schema({
  provider: { type: String, required: true },
  success: { type: Number, required: true }, // 1 or 0
  error_message: { type: String },
  screenshot_path: { type: String },
  duration_ms: { type: Number },
  created_at: { type: Date, default: Date.now }
});

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true }
});

// --- Models ---

const Bill = mongoose.model('Bill', billSchema);
const ScrapeLog = mongoose.model('ScrapeLog', scrapeLogSchema);
const Setting = mongoose.model('Setting', settingSchema);

// --- Functions ---

async function insertBill(billData) {
  try {
    const { provider, invoice_number, amount, billing_period, consumption, due_date, payment_url, payment_code, status, pdf_path, raw_data } = billData;
    
    // Convert undefined to null for saving (optional but good practice)
    const updateData = {
      invoice_number: invoice_number || null,
      amount,
      consumption: consumption || null,
      due_date: due_date || null,
      payment_url: payment_url || null,
      payment_code: payment_code || null,
      status: status || 'unpaid',
      pdf_path: pdf_path || null,
      raw_data: raw_data ? JSON.stringify(raw_data) : null,
      scraped_at: new Date()
    };

    // Upsert
    await Bill.findOneAndUpdate(
      { provider, billing_period },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    console.error(`Error inserting bill for ${billData.provider}:`, error);
  }
}

async function getBills(filters = {}) {
  const query = {};
  if (filters.provider) query.provider = filters.provider;
  if (filters.status) query.status = filters.status;
  
  let mQuery = Bill.find(query).sort({ due_date: 1 });
  if (filters.limit) mQuery = mQuery.limit(filters.limit);
  
  const results = await mQuery.lean();
  
  // Format dates / IDs back to strings for compatibility
  return results.map(doc => ({
    ...doc,
    id: doc._id.toString(),
    scraped_at: doc.scraped_at.toISOString()
  }));
}

async function getCurrentBills() {
  const providers = ['Inwi', 'SRM-CS'];
  const results = [];
  
  for (const provider of providers) {
    const bill = await Bill.findOne({ provider }).sort({ scraped_at: -1 }).lean();
    if (bill) {
      results.push({
        ...bill,
        id: bill._id.toString(),
        scraped_at: bill.scraped_at.toISOString()
      });
    }
  }
  return results;
}

async function getBillById(id) {
  try {
    const bill = await Bill.findById(id).lean();
    if (bill) {
      return {
        ...bill,
        id: bill._id.toString(),
        scraped_at: bill.scraped_at.toISOString()
      };
    }
    return null;
  } catch (error) {
    return null; // Invalid ObjectId
  }
}

async function markBillPaid(id) {
  try {
    await Bill.findByIdAndUpdate(id, { status: 'paid' });
  } catch (error) {
    console.error('Error marking bill paid:', error);
  }
}

async function getUnpaidBills() {
  const results = await Bill.find({ status: 'unpaid' }).sort({ due_date: 1 }).lean();
  return results.map(doc => ({
    ...doc,
    id: doc._id.toString(),
    scraped_at: doc.scraped_at.toISOString()
  }));
}

async function logScrape(logData) {
  try {
    await ScrapeLog.create({
      provider: logData.provider,
      success: logData.success ? 1 : 0,
      error_message: logData.error_message || null,
      screenshot_path: logData.screenshot_path || null,
      duration_ms: logData.duration_ms || 0
    });
  } catch (error) {
    console.error('Error logging scrape:', error);
  }
}

async function getLastScrapeTime() {
  const row = await ScrapeLog.findOne({ success: 1 }).sort({ created_at: -1 }).lean();
  return row && row.created_at ? row.created_at.toISOString() : null;
}

async function getRecentErrors(limit = 10) {
  const rows = await ScrapeLog.find().sort({ created_at: -1 }).limit(limit).lean();
  return rows.map(doc => ({
    ...doc,
    created_at: doc.created_at.toISOString()
  }));
}

async function getSetting(key) {
  const setting = await Setting.findOne({ key }).lean();
  return setting ? setting.value : null;
}

async function setSetting(key, value) {
  await Setting.findOneAndUpdate(
    { key },
    { value: String(value) },
    { upsert: true, new: true }
  );
}

async function getAllSettings() {
  const rows = await Setting.find().lean();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

async function saveAllSettings(settingsObj) {
  const operations = [];
  for (const [key, value] of Object.entries(settingsObj)) {
    if (value !== undefined && value !== null) {
      operations.push({
        updateOne: {
          filter: { key },
          update: { value: String(value) },
          upsert: true
        }
      });
    }
  }
  if (operations.length > 0) {
    await Setting.bulkWrite(operations);
  }
}

module.exports = {
  insertBill,
  getBills,
  getCurrentBills,
  getBillById,
  markBillPaid,
  getUnpaidBills,
  logScrape,
  getLastScrapeTime,
  getRecentErrors,
  getSetting,
  setSetting,
  getAllSettings,
  saveAllSettings
};
