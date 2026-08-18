const sqlite3 = require('better-sqlite3');
const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://achrafwebsite:0iotqR497aDmh6M2@cluster0.3uayczk.mongodb.net/bills_automation?retryWrites=true&w=majority&appName=Cluster0f';

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true }
});
const Setting = mongoose.model('Setting', settingSchema);

const migrate = async () => {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to Mongo');
        
        const db = sqlite3('./data/bills.db');
        const settings = db.prepare('SELECT * FROM settings').all();
        console.log(`Found ${settings.length} settings in SQLite`);
        
        for (const s of settings) {
            await Setting.findOneAndUpdate(
                { key: s.key },
                { value: s.value },
                { upsert: true }
            );
        }
        console.log('Migration complete');
    } catch (e) {
        console.error(e);
    } finally {
        process.exit();
    }
};

migrate();
