require("dotenv").config();
const express = require("express");
const nodemailer = require("nodemailer");

const { initDb, saveSubmission, listSubmissions, getSubmission } = require("./db");
const { generatePdfAndTxt } = require("./pdf_fill");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function basicAuth(expectedPassword) {
  return (req, res, next) => {
    const hdr = req.headers.authorization || "";
    if (!hdr.startsWith("Basic ")) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Protected"');
      return res.status(401).send("Auth richiesta");
    }
    const b64 = hdr.slice(6);
    const [user, pass] = Buffer.from(b64, "base64").toString("utf8").split(":");
    if (pass !== expectedPassword) return res.status(403).send("Password errata");
    req.authUser = user || "user";
    next();
  };
}

const formAuth = basicAuth(process.env.FORM_PASSWORD || "changeme");
const adminAuth = basicAuth(process.env.ADMIN_PASSWORD || "adminchangeme");

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

// --- EMAIL ---
function makeTransport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

async function sendMailWithAttachments({ subject, text, pdfFilename, pdfBytes, txtFilename, txtBytes }) {
  const transporter = makeTransport();
  await transporter.sendMail({
    from: `"${process.env.MAIL_FROM_NAME || "PV"}" <${process.env.GMAIL_USER}>`,
    to: process.env.MAIL_TO || "marianovbavaro@gmail.com",
    subject,
    text,
    attachments: [
      { filename: pdfFilename, content: pdfBytes, contentType: "application/pdf" },
      { filename: txtFilename, content: txtBytes, contentType: "text/plain; charset=utf-8" }
    ],
  });
}

// --- FORM ---
app.get("/", formAuth, (req, res) => {
  const body = `
  <p>Compila i dati e genera automaticamente PDF + TXT.</p>
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
    <button type="submit">Genera e invia</button>
  </form>
  <p style="margin-top:18px">
    Archivio (protetto): <a href="/admin">/admin</a>
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
      potenza_kw: (req.body.potenza_kw || "").trim()
    };

    // Validazioni minime
    for (const k of Object.keys(input)) {
      if (!input[k]) throw new Error(`Campo mancante: ${k}`);
    }

    const { pdfBytes, pdfFilename, txtBytes, txtFilename, chosenPdfTemplate, chosenTxtTemplate } =
      await generatePdfAndTxt(input);

    const saved = await saveSubmission({
      ...input,
      pdf_filename: pdfFilename,
      pdf_data: pdfBytes,
      txt_filename: txtFilename,
      txt_data: txtBytes
    });

    await sendMailWithAttachments({
      subject: `FV ${input.potenza_kw} kW - ${input.cognome} ${input.nome} - POD ${input.pod}`,
      text:
`Nuova generazione documenti FV:
- Cliente: ${input.nome} ${input.cognome}
- CF: ${input.codice_fiscale}
- Indirizzo: ${input.indirizzo}, ${input.comune}
- POD: ${input.pod}
- Potenza: ${input.potenza_kw} kW

Template PDF: ${chosenPdfTemplate}
Template TXT: ${chosenTxtTemplate}
ID archivio: ${saved.id}
Data: ${saved.created_at}
`,
      pdfFilename,
      pdfBytes,
      txtFilename,
      txtBytes
    });

    const ok = `<div class="ok">
      Generato e inviato correttamente.<br/>
      ID archivio: <b>${saved.id}</b><br/>
      <a href="/admin">Vai all’archivio</a>
    </div>
    <p><a href="/">Torna al form</a></p>`;
    res.send(htmlPage("OK", ok));
  } catch (e) {
    const err = `<div class="err">Errore: ${String(e.message || e)}</div><p><a href="/">Torna al form</a></p>`;
    res.status(400).send(htmlPage("Errore", err));
  }
});

// --- ARCHIVIO ---
app.get("/admin", adminAuth, async (req, res) => {
  const rows = await listSubmissions();
  const trs = rows.map(r => `
    <tr>
      <td>${r.id}</td>
      <td>${new Date(r.created_at).toLocaleString("it-IT")}</td>
      <td>${r.cognome} ${r.nome}</td>
      <td>${r.comune}</td>
      <td>${r.pod}</td>
      <td>${r.potenza_kw} kW</td>
      <td><a href="/admin/${r.id}/pdf">PDF</a></td>
      <td><a href="/admin/${r.id}/txt">TXT</a></td>
    </tr>
  `).join("");

  const body = `
    <p>Archivio documenti generati.</p>
    <table>
      <thead>
        <tr>
          <th>ID</th><th>Data</th><th>Cliente</th><th>Comune</th><th>POD</th><th>Potenza</th><th>PDF</th><th>TXT</th>
        </tr>
      </thead>
      <tbody>${trs}</tbody>
    </table>
  `;
  res.send(htmlPage("Archivio", body));
});

app.get("/admin/:id/pdf", adminAuth, async (req, res) => {
  const row = await getSubmission(req.params.id);
  if (!row) return res.status(404).send("Non trovato");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${row.pdf_filename}"`);
  res.send(row.pdf_data);
});

app.get("/admin/:id/txt", adminAuth, async (req, res) => {
  const row = await getSubmission(req.params.id);
  if (!row) return res.status(404).send("Non trovato");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${row.txt_filename}"`);
  res.send(row.txt_data);
});

// --- STARTUP ---
const port = Number(process.env.PORT || 3000);

initDb()
  .then(() => {
    app.listen(port, () => console.log(`Server avviato su :${port}`));
  })
  .catch((err) => {
    console.error("DB init error:", err);
    process.exit(1);
  });
