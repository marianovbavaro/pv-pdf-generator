const { Pool } = require("pg");

let cs = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: cs,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pdfs (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      cognome TEXT,
      indirizzo TEXT,
      comune TEXT,
      codice_fiscale TEXT,
      pod TEXT,
      potenza TEXT,
      pdf_path TEXT,
      txt_path TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

module.exports = { pool, initDb };

