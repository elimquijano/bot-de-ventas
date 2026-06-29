const storageService = require("./storage.service");
const externalService = require("./external.service");
const orchestratorService = require("./orchestrator.service");
const { checkIntention } = require("../hooks/client-intention");
const config = require("../config/envs");

class FlowService {
  async execute(inputData, accountConfig) {
    try {
      const input = this.normalizeInput(
        inputData,
        accountConfig.input_channel.type,
      );

      if (this.shouldIgnore(input)) {
        console.log(
          `[FlowService] Mensaje ignorado. evento=${input.eventType}, fromMe=${input.fromMe}, isGroup=${input.isGroup}, isStatus=${input.isStatus}, hasMessage=${input.hasMessage}, type=${input.type}`,
        );
        return { success: true, ignored: true };
      }

      const { phone, recipient, type, text, location, fromMe } = input;

      // Mensajes salientes (tú tomas el control): guardar en historial pero no responder
      if (fromMe) {
        if (text) {
          await storageService.saveMessage(phone, "assistant", text);
          console.log(
            `[FlowService] Mensaje saliente guardado en historial de ${phone}`,
          );
        }
        return { success: true, fromMe: true };
      }

      const history = await storageService.getChatHistory(phone);

      let userContent;
      if (type === "location" && location) {
        console.log(
          `[FlowService] Ubicación recibida de ${phone}: lat=${location.lat}, lon=${location.lon}`,
        );
        const address = config.MAPBOX_ACCESS_TOKEN
          ? await externalService.getReverseGeocoding(
              location.lat,
              location.lon,
              config.MAPBOX_ACCESS_TOKEN,
            )
          : "Dirección no disponible";
        userContent = `[UBICACIÓN COMPARTIDA: ${address} | lat=${location.lat}, lon=${location.lon}]`;
      } else {
        userContent = text;
      }

      console.log(`[FlowService] Nuevo mensaje de ${phone}: "${userContent}"`);

      const analysis = await checkIntention(
        history,
        userContent,
        accountConfig.agent,
      );
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
    if (input.isStatus) return true;
    if (input.isGroup) return true;
    if (!input.hasMessage) return true;
    if (input.type === "protocol") return true;
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
    const fromField = body.from || "";
    const isGroup = senderJid.includes("@g.us") || fromField.includes("@g.us");
    const isStatus =
      senderJid.includes("@status") ||
      fromField.includes("@status") ||
      fromField === "status@broadcast";

    // Tipos de mensajes de protocolo que deben ignorarse
    const protocolTypes = [
      "protocolMessage",
      "reactionMessage",
      "pollUpdateMessage",
      "ephemeralMessage",
      "senderKeyDistributionMessage",
    ];
    const isProtocol = protocolTypes.some((t) => !!msg[t]);

    if (isProtocol) {
      return this._emptyInput(eventType, phone, fromMe, "protocol");
    }

    const locationMsg = msg.locationMessage || null;

    const text = locationMsg
      ? ""
      : msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.buttonsResponseMessage?.selectedButtonId ||
        msg.listResponseMessage?.singleSelectReply?.selectedRowId ||
        body.text ||
        "";

    const location = locationMsg
      ? {
          lat: locationMsg.degreesLatitude,
          lon: locationMsg.degreesLongitude,
        }
      : null;

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
      type: locationMsg ? "location" : "text",
      text,
      location,
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

    if (!msg) return this._emptyInput("message.received");

    const phone = msg.from?.replace(/\D/g, "") || "";
    const isLocation = msg.type === "location";

    const text = isLocation
      ? ""
      : msg.text?.body ||
        msg.interactive?.button_reply?.title ||
        msg.interactive?.list_reply?.title ||
        "";

    const location = isLocation
      ? {
          lat: msg.location?.latitude,
          lon: msg.location?.longitude,
        }
      : null;

    return {
      eventType: "message.received",
      type: isLocation ? "location" : "text",
      text,
      location,
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

    if (!msg) return this._emptyInput(null);

    const phone = String(msg.chat?.id || "");
    const isLocation = !!msg.location;
    const isGroup =
      msg.chat?.type === "group" || msg.chat?.type === "supergroup";
    const text = isLocation ? "" : msg.text || msg.caption || "";

    const location = isLocation
      ? {
          lat: msg.location.latitude,
          lon: msg.location.longitude,
        }
      : null;

    return {
      eventType: "message.received",
      type: isLocation ? "location" : "text",
      text,
      location,
      recipient: phone,
      phone,
      fromMe: false,
      isStatus: false,
      isGroup,
      hasMessage: !!(msg.text || msg.location || msg.caption),
    };
  }

  _emptyInput(eventType, phone = "", fromMe = false, type = "text") {
    return {
      eventType,
      type,
      text: "",
      location: null,
      recipient: "",
      phone,
      fromMe,
      isStatus: false,
      isGroup: false,
      hasMessage: false,
    };
  }
}

module.exports = new FlowService();
