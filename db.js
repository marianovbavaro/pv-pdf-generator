const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      nome TEXT NOT NULL,
      cognome TEXT NOT NULL,
      indirizzo TEXT NOT NULL,
      comune TEXT NOT NULL,
      codice_fiscale TEXT NOT NULL,
      pod TEXT NOT NULL,
      potenza_kw TEXT NOT NULL,
      pdf_filename TEXT NOT NULL,
      pdf_data BYTEA NOT NULL,
      txt_filename TEXT NOT NULL,
      txt_data BYTEA NOT NULL
    );
  `);
}

async function saveSubmission(row) {
  const q = `
    INSERT INTO submissions
      (nome, cognome, indirizzo, comune, codice_fiscale, pod, potenza_kw,
       pdf_filename, pdf_data, txt_filename, txt_data)
    VALUES
      ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    RETURNING id, created_at;
  `;
  const vals = [
    row.nome, row.cognome, row.indirizzo, row.comune, row.codice_fiscale, row.pod, row.potenza_kw,
    row.pdf_filename, row.pdf_data, row.txt_filename, row.txt_data
  ];
  const res = await pool.query(q, vals);
  return res.rows[0];
}

async function listSubmissions() {
  const res = await pool.query(`
    SELECT id, created_at, nome, cognome, comune, pod, potenza_kw, pdf_filename, txt_filename
    FROM submissions
    ORDER BY created_at DESC;
  `);
  return res.rows;
}

async function getSubmission(id) {
  const res = await pool.query(`SELECT * FROM submissions WHERE id=$1`, [id]);
  return res.rows[0] || null;
}

module.exports = { pool, initDb, saveSubmission, listSubmissions, getSubmission };
