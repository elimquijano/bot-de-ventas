const crypto = require("crypto");
const flowService = require("../services/flow.service");
const accounts = require("../config/accounts");

class WebhookController {
  async handleIncoming(req, res) {
    const { id } = req.params;
    const accountConfig = accounts[id];

    if (!accountConfig) {
      console.error(`⚠️ Webhook ID no registrado: ${id}`);
      return res
        .status(404)
        .json({ error: "Webhook ID not found in configuration" });
    }

    // Responder 200 inmediatamente para no bloquear el webhook
    res.status(200).json({ status: "success" });

    const body = req.body;
    const event = body.event;

    // Filtro temprano: solo procesar message.received
    if (event !== "message.received") {
      console.log(`[WebhookController] Evento ignorado: ${event}`);
      return;
    }

    const { webhook_secret } = accountConfig.input_channel;
    if (webhook_secret) {
      const signature =
        req.headers["x-hub-signature-256"] || req.headers["x-webhook-secret"];
      if (!this._validateSignature(signature, body, webhook_secret)) {
        console.error(`⚠️ Firma inválida para webhook ID: ${id}`);
        return;
      }
    }

    try {
      console.log(
        `--- Nueva Interacción [Cuenta: ${id}] [Canal: ${accountConfig.input_channel.type}] [Evento: ${event}] ---`,
      );
      await flowService.execute(body, accountConfig);
    } catch (error) {
      console.error("❌ Webhook Controller Error:", error);
    }
  }

  _validateSignature(signature, body, secret) {
    if (!signature) return false;
    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", secret)
        .update(JSON.stringify(body))
        .digest("hex");
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
    } catch {
      return false;
    }
  }
}

module.exports = new WebhookController();
