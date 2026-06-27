const axios = require("axios");

class ExternalService {
  _buildHeaders(auth) {
    switch (auth.type) {
      case "bearer":
        return {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        };
      case "api_key":
        return {
          [auth.header]: auth.token,
          "Content-Type": "application/json",
        };
      case "basic":
        const encoded = Buffer.from(`${auth.user}:${auth.password}`).toString(
          "base64",
        );
        return {
          Authorization: `Basic ${encoded}`,
          "Content-Type": "application/json",
        };
      default:
        return { "Content-Type": "application/json" };
    }
  }

  async get(endpoint, auth) {
    try {
      const res = await axios.get(endpoint, {
        headers: this._buildHeaders(auth),
      });
      return res.data.data || res.data || [];
    } catch (error) {
      console.error(
        `[ExternalService] GET ${endpoint} falló:`,
        error.response?.status,
        error.message,
      );
      throw error;
    }
  }

  async post(endpoint, auth, body) {
    try {
      const res = await axios.post(endpoint, body, {
        headers: this._buildHeaders(auth),
      });
      return res.data;
    } catch (error) {
      console.error(
        `[ExternalService] POST ${endpoint} falló:`,
        error.response?.status,
        error.message,
      );
      throw error;
    }
  }

  async getReverseGeocoding(lat, lon, mapboxToken) {
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${mapboxToken}&limit=1`;
      const res = await axios.get(url);
      return res.data.features[0]?.place_name || "No enviada";
    } catch (error) {
      console.error("[ExternalService] Error in geocoding:", error.message);
      return "No enviada";
    }
  }

  async sendMessage(output_channel, recipient, content) {
    switch (output_channel.type) {
      case "whatsapp_baileys":
        return await this._sendWhatsappBaileys(
          output_channel,
          recipient,
          content,
        );
      case "whatsapp_cloud":
        return await this._sendWhatsappCloud(
          output_channel,
          recipient,
          content,
        );
      case "telegram":
        return await this._sendTelegram(output_channel, recipient, content);
      default:
        throw new Error(
          `[ExternalService] Canal de salida desconocido: ${output_channel.type}`,
        );
    }
  }

  async _sendWhatsappBaileys(output_channel, recipient, content) {
    try {
      const url = `${output_channel.api_url}/messages/text`;
      const cleanNumber = recipient.split("@")[0];

      console.log("[ExternalService] Enviando mensaje Baileys:");
      console.log(` - URL: ${url}`);
      console.log(` - Recipient: ${cleanNumber}`);

      const res = await axios.post(
        url,
        { recipient: cleanNumber, body: content },
        {
          headers: {
            Authorization: `Bearer ${output_channel.api_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      console.log("[ExternalService] Mensaje enviado:", res.data);
      return res.data;
    } catch (error) {
      console.error("[ExternalService] Error enviando mensaje Baileys:");
      if (error.response) {
        const isHtml =
          typeof error.response.data === "string" &&
          error.response.data.includes("<html");
        console.error(" - Status:", error.response.status);
        console.error(
          " - Data:",
          isHtml
            ? "[Respuesta HTML]"
            : JSON.stringify(error.response.data, null, 2),
        );
      } else {
        console.error(" - Error:", error.message);
      }
      throw error;
    }
  }

  async _sendWhatsappCloud(output_channel, recipient, content) {
    try {
      const url = `${output_channel.api_url}/messages`;
      const cleanNumber = recipient.split("@")[0];

      console.log("[ExternalService] Enviando mensaje WhatsApp Cloud:");
      console.log(` - URL: ${url}`);
      console.log(` - Recipient: ${cleanNumber}`);

      const res = await axios.post(
        url,
        {
          messaging_product: "whatsapp",
          to: cleanNumber,
          type: "text",
          text: { body: content },
        },
        {
          headers: {
            Authorization: `Bearer ${output_channel.api_token}`,
            "Content-Type": "application/json",
          },
        },
      );

      console.log("[ExternalService] Mensaje Cloud enviado:", res.data);
      return res.data;
    } catch (error) {
      console.error(
        "[ExternalService] Error enviando mensaje Cloud:",
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  async _sendTelegram(output_channel, recipient, content) {
    try {
      const url = `https://api.telegram.org/bot${output_channel.api_token}/sendMessage`;

      console.log("[ExternalService] Enviando mensaje Telegram:");
      console.log(` - Recipient: ${recipient}`);

      const res = await axios.post(url, {
        chat_id: recipient,
        text: content,
      });

      console.log("[ExternalService] Mensaje Telegram enviado:", res.data);
      return res.data;
    } catch (error) {
      console.error(
        "[ExternalService] Error enviando mensaje Telegram:",
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  async downloadMedia(output_channel, mediaKey) {
    try {
      const res = await axios.get(
        `${output_channel.api_url}/messages/download/${mediaKey}`,
        {
          headers: { Authorization: `Bearer ${output_channel.api_token}` },
          responseType: "arraybuffer",
        },
      );
      return Buffer.from(res.data).toString("base64");
    } catch (error) {
      console.error(
        "[ExternalService] Error downloading media:",
        error.message,
      );
      throw error;
    }
  }
}

module.exports = new ExternalService();
