const storageService = require("./storage.service");
const externalService = require("./external.service");
const orchestratorService = require("./orchestrator.service");
const { checkIntention } = require("../hooks/client-intention");

class FlowService {
  async execute(inputData, accountConfig) {
    try {
      const input = this.normalizeInput(
        inputData,
        accountConfig.input_channel.type,
      );

      if (this.shouldIgnore(input)) {
        console.log(
          `[FlowService] Mensaje ignorado. Razón: evento=${input.eventType}, fromMe=${input.fromMe}, isGroup=${input.isGroup}, isStatus=${input.isStatus}, hasMessage=${input.hasMessage}`,
        );
        return { success: true, ignored: true };
      }

      const { phone, recipient, text, fromMe, type } = input;

      const history = await storageService.getChatHistory(phone);
      const userContent = type === "location" ? "[UBICACIÓN GPS]" : text;

      console.log(`[FlowService] Nuevo mensaje de ${phone}: "${userContent}"`);

      const analysis = await checkIntention(history, userContent);
      console.log(
        `[FlowService] Análisis de intención: ${analysis.intention} (${analysis.reason})`,
      );

      const result = await orchestratorService.process(
        phone,
        analysis,
        history,
        userContent,
        accountConfig,
      );

      if (result.action === "ignore" || result.action === "close_loop") {
        console.log(
          `[FlowService] Acción: Ignorar/Cerrar flujo. Razón: ${result.reason}`,
        );
        await storageService.saveMessage(phone, "user", userContent);
        return { success: true, action: result.action };
      }

      if (result.content) {
        console.log(`[FlowService] Enviando respuesta a ${phone}...`);

        await storageService.saveMessage(phone, "user", userContent);
        await storageService.saveMessage(phone, "assistant", result.content);

        const isTestToken =
          !accountConfig.output_channel.api_token ||
          accountConfig.output_channel.api_token === "TEST_TOKEN";

        if (!isTestToken) {
          await externalService.sendMessage(
            accountConfig.output_channel,
            recipient,
            result.content,
          );
        } else {
          console.log(
            "[FlowService] Envío omitido (token de prueba o no configurado).",
          );
          console.log(`[FlowService] Respuesta generada: "${result.content}"`);
        }
      }

      return { success: true, result };
    } catch (error) {
      console.error("[FlowService] ERROR CRÍTICO:", error);
      throw error;
    }
  }

  shouldIgnore(input) {
    if (input.eventType !== "message.received") return true;
    if (input.fromMe === true) return true;
    if (input.isStatus) return true;
    if (input.isGroup) return true;
    if (!input.hasMessage) return true;
    if (input.type === "text" && !input.text?.trim()) return true;
    return false;
  }

  normalizeInput(data, channelType) {
    switch (channelType) {
      case "whatsapp_baileys":
        return this._normalizeBaileys(data);
      case "whatsapp_cloud":
        return this._normalizeWhatsappCloud(data);
      case "telegram":
        return this._normalizeTelegram(data);
      default:
        console.warn(
          `[FlowService] Canal desconocido: ${channelType}, usando Baileys por defecto.`,
        );
        return this._normalizeBaileys(data);
    }
  }

  _normalizeBaileys(data) {
    const eventType = data.event || null;
    const body = data.data || {};
    const msg = body.message || {};

    const senderJid = body.senderJid || "";
    const senderNumber = body.senderNumber || senderJid.split("@")[0] || "";
    const phone = senderNumber.replace(/\D/g, "");

    const fromMe = body.fromMe === true;

    const isGroup =
      senderJid.includes("@g.us") || (body.from || "").includes("@g.us");

    const isStatus =
      senderJid.includes("@status") || (body.from || "").includes("@status");

    const text =
      msg.conversation ||
      msg.extendedTextMessage?.text ||
      msg.imageMessage?.caption ||
      msg.videoMessage?.caption ||
      msg.buttonsResponseMessage?.selectedButtonId ||
      msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
      body.text ||
      "";

    const hasMessage = !!(
      msg.conversation ||
      msg.extendedTextMessage ||
      msg.imageMessage ||
      msg.videoMessage ||
      msg.locationMessage ||
      msg.buttonsResponseMessage ||
      msg.listResponseMessage ||
      body.text
    );

    return {
      eventType,
      type: msg.locationMessage ? "location" : "text",
      text,
      recipient: senderJid,
      phone,
      fromMe,
      isStatus,
      isGroup,
      hasMessage,
    };
  }

  _normalizeWhatsappCloud(data) {
    const entry = data.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if (!msg) {
      return this._emptyInput("message.received");
    }

    const phone = msg.from?.replace(/\D/g, "") || "";
    const text =
      msg.text?.body ||
      msg.interactive?.button_reply?.title ||
      msg.interactive?.list_reply?.title ||
      "";

    return {
      eventType: "message.received",
      type: msg.type === "location" ? "location" : "text",
      text,
      recipient: `${phone}@s.whatsapp.net`,
      phone,
      fromMe: false,
      isStatus: false,
      isGroup: false,
      hasMessage: !!msg,
    };
  }

  _normalizeTelegram(data) {
    const msg = data.message || data.edited_message;

    if (!msg) {
      return this._emptyInput(null);
    }

    const phone = String(msg.chat?.id || "");
    const text = msg.text || msg.caption || "";
    const isGroup =
      msg.chat?.type === "group" || msg.chat?.type === "supergroup";

    return {
      eventType: "message.received",
      type: msg.location ? "location" : "text",
      text,
      recipient: phone,
      phone,
      fromMe: false,
      isStatus: false,
      isGroup,
      hasMessage: !!(msg.text || msg.location || msg.caption),
    };
  }

  _emptyInput(eventType) {
    return {
      eventType,
      type: "text",
      text: "",
      recipient: "",
      phone: "",
      fromMe: false,
      isStatus: false,
      isGroup: false,
      hasMessage: false,
    };
  }
}

module.exports = new FlowService();
