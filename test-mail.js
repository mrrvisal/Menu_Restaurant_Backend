// test-mail.js
require("dotenv").config();
const { sendMail } = require("./config/mailer");

async function test() {
  console.log("🧪 Testing Gmail SMTP with IPv4...");
  console.log(`📧 From: ${process.env.SMTP_USER}`);
  console.log(
    `📧 Password: ${process.env.SMTP_PASS ? "✅ Set" : "❌ Not set"}`,
  );

  const result = await sendMail({
    to: "mrrvisal617@gmail.com",
    subject: "✅ Test - Gmail SMTP Working!",
    html: `
      <h1>✅ Success!</h1>
      <p>Your Gmail SMTP is working on Render with IPv4.</p>
      <p>Time: ${new Date().toISOString()}</p>
    `,
  });

  console.log("Result:", result);
}

test();
