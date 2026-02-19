require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");
const { Pool } = require("pg");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// =====================
// ENV
// =====================
const FORM_PASSWORD = process.env.FORM_PASSWORD || "1234";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "5678";

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const MAIL_TO = process.env.MAIL_TO || "marianovbavaro@gmail.com";

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL env var");
}

// Render a volte fornisce postgresql://; pg accetta anche postgres://.
// Qui normalizziamo.
const DATABASE_URL = (process.env.DATABASE_URL || "").replace(/^postgresql:\/\//, "postgres://");

// =====================
// PATHS (FIX DEFINITIVO)
// =====================
// IMPORTANTISSIMO: usa process.cwd() così trova /templates anche su Render
const BASE_TEMPLATES = path.join(process.cwd(), "templates");
const PDF_TEMPLATES_DIR = path.join(BASE_TEMPLATES, "pdf");
const TXT_TEMPLATES_DIR = path.join(BASE_TEMPLATES, "txt");

// mapping potenze
const PDF_TEMPLATES = {
  "2": "Monofase_BT_senza_accumulo_2.0 kW.pdf",
  "3": "Monofase_BT_senza_accumulo_3.0 kW.pdf",
  "3.6": "Monofase_BT_senza_accumulo_3.6 kW.pdf",
  "5": "Monofase_BT_senza_accumulo_5.0 kW.pdf",
  "6": "Monofase_BT_senza_accumulo_6.0 kW.pdf",
};

const TXT_TEMPLATES = {
  "2": "cm 2.0 kW.txt",
  "3": "cm 3.0 kW.txt",
  "3.6": "cm 3.6 kW.txt",
  "5": "cm 5.0 kW.txt",
  "6": "cm 6.0 kW.txt",
};

// =====================
// BASIC AUTH (solo password, username qualsiasi)
// =====================
function basicAuth(expectedPassword) {
  return (req, res, next) => {
    const hdr = req.headers.authorization || "";
    if (!hdr.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Protected"');
      return res.status(401).send("Auth richiesta");
    }
    const b64 = hdr.slice(6);
    const parts = Buffer.from(b64, "base64").toString("utf8").split(":");
    const pass = parts.length >= 2 ? parts.slice(1).join(":") : "";
    if (pass !== expectedPassword) return res.status(403).send("Password errata");
    next();
  };
}
const formAuth = basicAuth(FORM_PASSWORD);
const adminAuth = basicAuth(ADMIN_PASSWORD);

// =====================
// DB
// =====================
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
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

// =====================
// EMAIL
// =====================
function mailTransport() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.warn("GMAIL_USER or GMAIL_APP_PASSWORD not set (email disabled)");
    return null;
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

// =====================
// PDF GENERATION (overlay dati in alto a sinistra)
// =====================
function safeFilename(s) {
  return String(s).replace(/[^\w.-]+/g, "_");
}

async function generatePdfFromTemplate(templatePath, input) {
  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.getPages()[0];

  // coordinate (tarabili via ENV)
  const x = Number(process.env.PDF_X || 55);
  const yTop = Number(process.env.PDF_Y_TOP || 770);
  const gap = Number(process.env.PDF_LINE_GAP || 14);
  const fontSize = Number(process.env.PDF_FONT_SIZE || 10);

  const fullName = `${input.nome} ${input.cognome}`.trim();

  const lines = [
    `COMMITTENTE: ${fullName}`,
    `CF: ${input.codice_fiscale}`,
    `INDIRIZZO: ${input.indirizzo}`,
    `COMUNE: ${input.comune}`,
    `POD: ${input.pod}`,
    `POTENZA: ${input.potenza_kw} kW`,
  ];

  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i], {
      x,
      y: yTop - i * gap,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const out = await pdfDoc.save();
  return Buffer.from(out);
}

// =====================
// UI HTML
// =====================
function htmlPage(title, body) {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu;max-width:900px;margin:40px auto;padding:0 16px}
    label{display:block;margin-top:10px;font-weight:600}
    input,select{width:100%;padding:10px;margin-top:6px}
    button{margin-top:16px;padding:12px 16px;font-weight:700;cursor:pointer}
    .ok{padding:12px;background:#e8ffe8;border:1px solid #9be19b}
    .err{padding:12px;background:#ffe8e8;border:1px solid #e19b9b}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    td,th{border:1px solid #ddd;padding:8px;text-align:left}
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

// =====================
// ROUTES
// =====================
app.get("/", formAuth, (req, res) => {
  const body = `
  <p>Compila i dati. Verrà generato PDF + TXT e inviato via email.</p>
  <form method="POST" action="/submit">
    <label>Nome</label><input name="nome" required />
    <label>Cognome</label><input name="cognome" required />
    <label>Indirizzo</label><input name="indirizzo" required />
    <label>Comune</label><input name="comune" required />
    <label>Codice Fiscale</label><input name="codice_fiscale" required />
    <label>POD</label><input name="pod" required />
    <label>Potenza impianto (kW)</label>
    <select name="potenza_kw" required>
      <option value="2">2</option>
      <option value="3">3</option>
      <option value="3.6">3.6</option>
      <option value="5">5</option>
      <option value="6">6</option>
    </select>
    <button type="submit">Genera</button>
  </form>
  <p style="margin-top:18px">
    Archivio: <a href="/admin">/admin</a>
  </p>
  `;
  res.send(htmlPage("Generatore PDF FV", body));
});

app.post("/submit", formAuth, async (req, res) => {
  try {
    const input = {
      nome: (req.body.nome || "").trim(),
      cognome: (req.body.cognome || "").trim(),
      indirizzo: (req.body.indirizzo || "").trim(),
      comune: (req.body.comune || "").trim(),
      codice_fiscale: (req.body.codice_fiscale || "").trim(),
      pod: (req.body.pod || "").trim(),
      potenza_kw: (req.body.potenza_kw || "").trim(),
    };

    for (const k of Object.keys(input)) {
      if (!input[k]) throw new Error(`Campo mancante: ${k}`);
    }

    if (!PDF_TEMPLATES[input.potenza_kw]) throw new Error("Potenza non valida");

    const pdfTemplatePath = path.join(PDF_TEMPLATES_DIR, PDF_TEMPLATES[input.potenza_kw]);
    const txtTemplatePath = path.join(TXT_TEMPLATES_DIR, TXT_TEMPLATES[input.potenza_kw]);

    if (!fs.existsSync(pdfTemplatePath)) {
      throw new Error(`Template PDF non trovato: ${pdfTemplatePath}`);
    }
    if (!fs.existsSync(txtTemplatePath)) {
      throw new Error(`Template TXT non trovato: ${txtTemplatePath}`);
    }

    const pdfBytes = await generatePdfFromTemplate(pdfTemplatePath, input);
    const txtBytes = fs.readFileSync(txtTemplatePath);

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const base = safeFilename(`${input.cognome}_${input.nome}_${input.potenza_kw}kW_${ts}`);
    const pdfFilename = `${base}.pdf`;
    const txtFilename = `${base}.txt`;

    // salva DB
    const saved = await pool.query(
      `INSERT INTO submissions
        (nome, cognome, indirizzo, comune, codice_fiscale, pod, potenza_kw,
         pdf_filename, pdf_data, txt_filename, txt_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id, created_at;`,
      [
        input.nome, input.cognome, input.indirizzo, input.comune, input.codice_fiscale, input.pod, input.potenza_kw,
        pdfFilename, pdfBytes, txtFilename, txtBytes
      ]
    );

    // invio email (se configurato)
    const tx = mailTransport();
    if (tx) {
      await tx.sendMail({
        from: `"PV Generator" <${GMAIL_USER}>`,
        to: MAIL_TO,
        subject: `FV ${input.potenza_kw} kW - ${input.cognome} ${input.nome} - POD ${input.pod}`,
        text:
`Nuova pratica FV:
Cliente: ${input.nome} ${input.cognome}
CF: ${input.codice_fiscale}
Indirizzo: ${input.indirizzo}, ${input.comune}
POD: ${input.pod}
Potenza: ${input.potenza_kw} kW
ID DB: ${saved.rows[0].id}
`,
        attachments: [
          { filename: pdfFilename, content: pdfBytes, contentType: "application/pdf" },
          { filename: txtFilename, content: txtBytes, contentType: "text/plain; charset=utf-8" },
        ],
      });
    }

    res.send(
      htmlPage(
        "OK",
        `<div class="ok">
          Generato correttamente. ID archivio: <b>${saved.rows[0].id}</b><br/>
          <a href="/admin">Vai all’archivio</a>
        </div>
        <p><a href="/">Torna al form</a></p>`
      )
    );
  } catch (e) {
    console.error(e);
    res.status(400).send(htmlPage("Errore", `<div class="err">${String(e.message || e)}</div><p><a href="/">Torna al form</a></p>`));
  }
});

app.get("/admin", adminAuth, async (req, res) => {
  const rows = await pool.query(`
    SELECT id, created_at, nome, cognome, comune, pod, potenza_kw, pdf_filename, txt_filename
    FROM submissions
    ORDER BY created_at DESC;
  `);

  const trs = rows.rows
    .map(
      (r) => `
    <tr>
      <td>${r.id}</td>
      <td>${new Date(r.created_at).toLocaleString("it-IT")}</td>
      <td>${r.cognome} ${r.nome}</td>
      <td>${r.comune}</td>
      <td>${r.pod}</td>
      <td>${r.potenza_kw} kW</td>
      <td><a href="/admin/${r.id}/pdf">PDF</a></td>
      <td><a href="/admin/${r.id}/txt">TXT</a></td>
    </tr>`
    )
    .join("");

  res.send(
    htmlPage(
      "Archivio",
      `<table>
        <thead>
          <tr>
            <th>ID</th><th>Data</th><th>Cliente</th><th>Comune</th><th>POD</th><th>Potenza</th><th>PDF</th><th>TXT</th>
          </tr>
        </thead>
        <tbody>${trs}</tbody>
      </table>`
    )
  );
});

app.get("/admin/:id/pdf", adminAuth, async (req, res) => {
  const row = await pool.query(`SELECT pdf_filename, pdf_data FROM submissions WHERE id=$1`, [req.params.id]);
  if (!row.rows[0]) return res.status(404).send("Non trovato");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${row.rows[0].pdf_filename}"`);
  res.send(row.rows[0].pdf_data);
});

app.get("/admin/:id/txt", adminAuth, async (req, res) => {
  const row = await pool.query(`SELECT txt_filename, txt_data FROM submissions WHERE id=$1`, [req.params.id]);
  if (!row.rows[0]) return res.status(404).send("Non trovato");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${row.rows[0].txt_filename}"`);
  res.send(row.rows[0].txt_data);
});

// =====================
// START (non bloccare l'avvio se DB init fallisce)
// =====================
const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, () => {
  console.log(`Server avviato su :${PORT}`);
});

initDb()
  .then(() => console.log("DB init OK"))
  .catch((err) => console.error("DB init error:", err));
