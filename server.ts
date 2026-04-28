import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import fs from "fs";
import Database from "better-sqlite3";

dotenv.config();

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Initialize SQLite database
const dbFile = path.join(process.cwd(), "data.db");
const db = new Database(dbFile);

// Create table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT,
    body_stats TEXT,
    garment_stats TEXT,
    body_image_path TEXT,
    garment_image_path TEXT,
    result_image_path TEXT,
    user_email TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Increase payload limit to handle base64 images
  app.use(express.json({ limit: '20mb' }));

  // Serve uploads directory
  app.use('/uploads', express.static(UPLOADS_DIR));

  // Helper to save base64 to file
  const saveImage = (base64Data: string, prefix: string) => {
    if (!base64Data || !base64Data.includes(",")) return null;
    const [header, body] = base64Data.split(",");
    const extension = header.split(";")[0].split("/")[1] || "jpg";
    const filename = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1000)}.${extension}`;
    const filepath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filepath, Buffer.from(body, 'base64'));
    return `/uploads/${filename}`; // Return relative path for web access
  };

  // API Route to handle data submission
  app.post("/api/submit-data", async (req, res) => {
    const { 
      category, 
      bodyStats, 
      garmentStats, 
      userEmail,
      bodyImage,
      garmentImage,
      resultImage
    } = req.body;

    console.log("Received submission for:", userEmail || "Anonymous");

    try {
      // Save images to local storage
      const bodyPath = saveImage(bodyImage, "body");
      const garmentPath = saveImage(garmentImage, "garment");
      const resultPath = saveImage(resultImage, "result");

      // Save to Database
      const stmt = db.prepare(`
        INSERT INTO submissions (
          category, body_stats, garment_stats, body_image_path, garment_image_path, result_image_path, user_email
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        category,
        JSON.stringify(bodyStats),
        JSON.stringify(garmentStats),
        bodyPath,
        garmentPath,
        resultPath,
        userEmail || null
      );

      // Email Notification (Optional)
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.GMAIL_USER,
          pass: process.env.GMAIL_PASS,
        },
      });

      const mailOptions = {
        from: process.env.GMAIL_USER,
        to: process.env.DESTINATION_EMAIL || 'preyaapatell7@gmail.com',
        subject: `New Try-On Session: ${category?.toUpperCase()}`,
        text: `
          New Try-on Session Collected:
          
          Category: ${category}
          
          Measurements & Data have been stored in the local database.
          Body Image: ${bodyPath ? `Available at ${bodyPath}` : 'N/A'}
          Garment Image: ${garmentPath ? `Available at ${garmentPath}` : 'N/A'}
          Result Image: ${resultPath ? `Available at ${resultPath}` : 'N/A'}
          
          Session Time: ${new Date().toLocaleString()}
        `,
      };

      if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
        await transporter.sendMail(mailOptions);
        console.log("Email notification sent.");
      }

      res.json({ 
        success: true, 
        message: "Data and images collected successfully.",
        paths: { bodyPath, garmentPath, resultPath }
      });

    } catch (error) {
      console.error("Error processing submission:", error);
      res.status(500).json({ success: false, message: "Internal server error during data collection." });
    }
  });

  // Admin route to view submissions (basic)
  app.get("/api/admin/submissions", (req, res) => {
    try {
      const rows = db.prepare("SELECT * FROM submissions ORDER BY timestamp DESC").all();
      res.json(rows);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch submissions" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
