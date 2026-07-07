// test-mail.js
require("dotenv").config();
const { sendMail } = require("./config/mailer");

async function test() {
  console.log("🧪 Testing Brevo API...");
  console.log(`📧 From: ${process.env.BREVO_FROM_NAME || "Digital Menu"} <${process.env.BREVO_FROM_EMAIL || "noreply@digitalmenu.com"}>`);
  console.log(
    `📧 API Key: ${process.env.BREVO_API_KEY ? "✅ Set" : "❌ Not set"}`,
  );

  const result = await sendMail({
    to: "mrrvisal617@gmail.com",
    subject: "✅ Test - Brevo Working!",
    html: `
      <h1>✅ Success!</h1>
      <p>Your Brevo API is working.</p>
      <p>Time: ${new Date().toISOString()}</p>
    `,
  });

  console.log("Result:", result);
}

test();