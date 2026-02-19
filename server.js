require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const nodemailer = require("nodemailer");

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// ================================
// CONFIG
// ================================

const FORM_PASSWORD = process.env.FORM_PASSWORD || "1234";

const BASE_PATH = path.join(process.cwd(), "templates");
const TXT_PATH = path.join(BASE_PATH, "txt");
const PDF_PATH = path.join(BASE_PATH, "pdf");


// ================================
// EMAIL CONFIG
// ================================

const transporter = nodemailer.createTransport({

    service: "gmail",

    auth: {

        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
    }
});


// ================================
// HOME
// ================================

app.get("/", (req, res) => {

    res.send(`

        <h2>TettoVivo PDF Generator</h2>

        <form method="POST" action="/generate">

        Password:<br>
        <input type="password" name="password"/><br><br>

        Nome:<br>
        <input name="nome"/><br>

        Cognome:<br>
        <input name="cognome"/><br>

        Email:<br>
        <input name="email"/><br>

        Potenza (es. 2.0):<br>
        <input name="kw"/><br><br>

        <button type="submit">Genera</button>

        </form>

    `);

});


// ================================
// GENERATE
// ================================

app.post("/generate", async (req, res) => {

try {

    const { password, nome, cognome, email, kw } = req.body;

    if (password !== FORM_PASSWORD) {

        return res.send("Password errata");
    }


    // nome file

    const txtFile = `cm ${kw} kW.txt`;
    const pdfFile = `cm ${kw} kW.pdf`;


    const txtTemplate = path.join(TXT_PATH, txtFile);
    const pdfTemplate = path.join(PDF_PATH, pdfFile);


    // controllo esistenza

    if (!fs.existsSync(txtTemplate)) {

        throw new Error("File TXT non trovato: " + txtTemplate);
    }

    if (!fs.existsSync(pdfTemplate)) {

        throw new Error("File PDF non trovato: " + pdfTemplate);
    }


    // copia PDF

    const outputPdf = path.join(process.cwd(), `output_${Date.now()}.pdf`);

    fs.copyFileSync(pdfTemplate, outputPdf);


    // invia email

    await transporter.sendMail({

        from: process.env.GMAIL_USER,

        to: email,

        subject: "Schema Fotovoltaico",

        text: "In allegato il PDF",

        attachments: [

            {

                filename: pdfFile,

                path: outputPdf
            }
        ]
    });


    res.send("PDF inviato con successo");


} catch (err) {

    console.error(err);

    res.send(`

        <h2>Errore</h2>

        <pre>${err.message}</pre>

        <a href="/">Torna indietro</a>

    `);

}

});



// ================================
// START SERVER
// ================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

console.log("Server avviato su porta " + PORT);

});
