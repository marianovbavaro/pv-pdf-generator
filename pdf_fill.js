const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const PDF_TEMPLATES = {
  "2":  "Monofase_BT_senza_accumulo_2.0 kW.pdf",
  "3":  "Monofase_BT_senza_accumulo_3.0 kW.pdf",
  "3.6":"Monofase_BT_senza_accumulo_3.6 kW.pdf",
  "5":  "Monofase_BT_senza_accumulo_5.0 kW.pdf",
  "6":  "Monofase_BT_senza_accumulo_6.0 kW.pdf"
};

const TXT_TEMPLATES = {
  "2":  "cm 2.0 kW.txt",
  "3":  "cm 3.0 kW.txt",
  "3.6":"cm 3.6 kW.txt",
  "5":  "cm 5.0 kW.txt",
  "6":  "cm 6.0 kW.txt"
};

function safeFilename(s) {
  return String(s).replace(/[^\w.-]+/g, "_");
}

async function generatePdfAndTxt(input) {
  const { potenza_kw } = input;
  if (!PDF_TEMPLATES[potenza_kw]) throw new Error("Potenza non valida");
  if (!TXT_TEMPLATES[potenza_kw]) throw new Error("TXT non valido");

  const pdfTemplatePath = path.join(__dirname, "templates", "pdf", PDF_TEMPLATES[potenza_kw]);
  const txtTemplatePath = path.join(__dirname, "templates", "txt", TXT_TEMPLATES[potenza_kw]);

  const templateBytes = fs.readFileSync(pdfTemplatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.getPages()[0];

  // Coordinate configurabili da env (così le tari al volo su Render)
  const x = Number(process.env.PDF_X || 55);
  const yTop = Number(process.env.PDF_Y_TOP || 770);
  const gap = Number(process.env.PDF_LINE_GAP || 14);
  const fontSize = Number(process.env.PDF_FONT_SIZE || 10);

  // Righe da scrivere (in alto a sinistra)
  const tecnico = process.env.TECHNICAL_NAME || "";
  const fullName = `${input.nome} ${input.cognome}`.trim();
  const loc = input.comune.trim();

  const lines = [
    `COMMITTENTE: ${fullName} (CF: ${input.codice_fiscale})`,
    tecnico ? `TECNICO: ${tecnico}` : `TECNICO:`,
    `LOCALITÀ: ${loc}`,
    `INDIRIZZO: ${input.indirizzo}`,
    `POTENZA: ${potenza_kw} kW`,
    `POD: ${input.pod}`
  ];

  // Disegno testo (nero)
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i], {
      x,
      y: yTop - i * gap,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  }

  const outPdfBytes = await pdfDoc.save();

  // TXT: prendo il file corrispondente e lo salvo così com’è
  const outTxtBytes = fs.readFileSync(txtTemplatePath);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = safeFilename(`${input.cognome}_${input.nome}_${potenza_kw}kW_${timestamp}`);

  return {
    pdfBytes: Buffer.from(outPdfBytes),
    pdfFilename: `${base}.pdf`,
    txtBytes: Buffer.from(outTxtBytes),
    txtFilename: `${base}.txt`,
    chosenPdfTemplate: PDF_TEMPLATES[potenza_kw],
    chosenTxtTemplate: TXT_TEMPLATES[potenza_kw],
  };
}

module.exports = { generatePdfAndTxt };
