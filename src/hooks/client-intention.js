const cohereService = require("../services/cohere.service");

/**
 * Determina si un mensaje entrante requiere intervención del bot.
 * Recibe el contexto del agente para filtrar con precisión según el rol del negocio.
 */
async function checkIntention(history, newMessage, agent) {
  const systemPrompt = `
    Eres un filtro de intención para un asistente virtual de WhatsApp.
    El asistente trabaja para un negocio con el siguiente rol: "${agent.role}".
    Contexto del negocio: "${agent.prompt}".

    Tu única misión es decidir si el bot DEBE responder o NO al mensaje del usuario.

    RESPONDE "interested" (el bot debe intervenir) SOLO si:
    - El usuario saluda o inicia una conversación relacionada con el negocio.
    - El usuario hace una pregunta o solicitud relacionada con los productos o servicios del negocio.
    - El usuario expresa intención de compra, quiere hacer un pedido, o pide información de precios.
    - El usuario responde directamente a una pregunta que el bot le hizo en el historial para continuar un proceso activo.
    - El usuario reporta un problema con su pedido o solicita seguimiento o cancelación.

    RESPONDE "not_interested" (el bot NO debe intervenir) si:
    - El mensaje no tiene relación con el negocio ni con ningún proceso activo en el historial.
    - El usuario envía saludos, emojis, audios, stickers o contenido sin solicitud concreta.
    - El mensaje es una cita, chiste, meme, estado de ánimo u otro contenido fuera de contexto.
    - El usuario ya completó su pedido y solo envía agradecimientos o despedidas sin nueva solicitud.
    - El mensaje parece ser una conversación privada del usuario consigo mismo o con otra persona.
    - El usuario comparte su ubicación sin que el bot se la haya pedido previamente en el historial.
    - El mensaje es ambiguo y el historial NO tiene un proceso activo abierto que lo contextualice.

    REGLA CLAVE: Si hay un proceso de compra activo en el historial (el bot preguntó algo y el usuario responde),
    considera "interested" aunque el mensaje parezca corto o ambiguo (ej: "sí", "1", "confirmar").
    Si NO hay proceso activo, sé estricto y filtra todo lo que no sea una solicitud clara al negocio.

    Historial reciente: ${JSON.stringify(history.slice(-6))}

    Responde ESTRICTAMENTE en JSON:
    {
        "intention": "interested" | "not_interested",
        "reason": "razón breve y concisa"
    }
    `;

  try {
    const result = await cohereService.chat(systemPrompt, [
      { role: "user", content: newMessage },
    ]);
    return result;
  } catch (error) {
    console.error("[checkIntention] Error:", error.message);
    return {
      intention: "interested",
      reason: "Error en análisis, se asume intervención por seguridad",
    };
  }
}

module.exports = { checkIntention };
