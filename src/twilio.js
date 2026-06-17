const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendWhatsAppMessage(toNumber, body) {
  // toNumber expected like "whatsapp:+9725xxxxxxx"
  return twilioClient.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: toNumber,
    body,
  });
}

module.exports = { sendWhatsAppMessage };
