const cohereService = require("../services/cohere.service");
const externalService = require("../services/external.service");

async function handleResponder(accountConfig, history, message) {
  const { role, prompt, context } = accountConfig.agent;

  const systemPrompt = `
    ROL: ${role}
    CONTEXTO DE LA EMPRESA: ${prompt}
    TONO DE RESPUESTA: ${context}

    Instrucciones:
    - Responde de forma amable y servicial.
    - Usa la información del historial para dar continuidad.
    - Si no tienes la respuesta, indica que consultarás con un humano.
    
    Responde ÚNICAMENTE en JSON:
    {
        "content": "Tu respuesta aquí...",
        "action": "message"
    }
    `;

  try {
    const aiResponse = await cohereService.chat(systemPrompt, [
      ...history,
      { role: "user", content: message },
    ]);
    return { action: "message", content: aiResponse.content };
  } catch (error) {
    console.error("[handleResponder] Error:", error.message);
    return {
      action: "message",
      content:
        "Lo siento, tuve un problema al procesar tu mensaje. ¿Podrías repetirlo?",
    };
  }
}

async function handleConsultarProductos(accountConfig, history, message, data) {
  const { auth, endpoints } = accountConfig.permissions.consultar_productos;

  try {
    console.log("[Task: Consultar] Obteniendo productos...");
    const products = await externalService.get(endpoints.list, auth);
    const availableProducts = products.filter((p) => p.stock > 0);

    if (availableProducts.length === 0) {
      return {
        action: "message",
        content: "En este momento no tenemos productos con stock disponible.",
      };
    }

    const { role, prompt, context } = accountConfig.agent;

    const systemPrompt = `
        ROL: ${role}
        CONTEXTO DE LA EMPRESA: ${prompt}
        TONO DE RESPUESTA: ${context}

        PRODUCTOS DISPONIBLES CON STOCK:
        ${availableProducts.map((p) => `- ID:${p.id} | ${p.name} | S/${p.price} | Stock: ${p.stock}`).join("\n")}

        El usuario pregunta por productos. Muéstrale las opciones disponibles de forma atractiva y clara.
        Usa el historial de conversación para dar continuidad si ya se habló de algún producto antes.

        Responde ÚNICAMENTE en JSON:
        {
            "content": "Tu respuesta con la lista de productos...",
            "action": "list_products"
        }
        `;

    const aiResponse = await cohereService.chat(systemPrompt, [
      ...history,
      { role: "user", content: message },
    ]);

    return {
      action: "message",
      content: aiResponse.content,
      data: availableProducts,
    };
  } catch (error) {
    console.error("[handleConsultarProductos] Error:", error.message);
    return {
      action: "message",
      content: "Lo siento, no pude consultar el catálogo en este momento.",
    };
  }
}

async function handleAgendarPedido(accountConfig, history, message, data) {
  const { auth, endpoints } = accountConfig.permissions.agendar_pedido;
  const { role, prompt, context } = accountConfig.agent;

  try {
    const [clients, cashRegisters] = await Promise.all([
      externalService.get(endpoints.check_customer, auth),
      externalService.get(endpoints.cash_registers, auth),
    ]);

    const systemPrompt = `
        ROL: ${role}
        CONTEXTO DE LA EMPRESA: ${prompt}
        TONO DE RESPUESTA: ${context}

        Estás procesando un pedido de un cliente que escribe por WhatsApp.

        DATO IMPORTANTE: El número de WhatsApp del cliente es el mismo número con el que está chateando.
        Búscalo en la lista de clientes por su número. NO le pidas su teléfono, ya lo tienes.

        CLIENTES REGISTRADOS EN EL SISTEMA:
        ${JSON.stringify(clients.map((c) => ({ id: c.id, name: c.name, phone: c.phone, address: c.address })))}

        CAJAS ABIERTAS:
        ${JSON.stringify(cashRegisters.map((c) => ({ id: c.id, name: c.name })))}

        HISTORIAL DE CONVERSACIÓN (contiene el producto y cantidad ya elegidos si los hay):
        ${JSON.stringify(history)}

        INSTRUCCIONES:
        1. Revisa el historial — puede que el cliente ya eligió producto y cantidad antes de llegar aquí.
        2. Busca al cliente por su número de WhatsApp en la lista de clientes registrados.
        3. Si está registrado, usa su dirección guardada y confirma el pedido.
        4. Si no está registrado, pide solo lo que falta: nombre y dirección.
        5. Cuando tengas: cliente identificado (o datos nuevos), producto, cantidad y dirección → acción "create_order".
        6. Si falta algo, pide solo ese dato específico → acción "collect_data".
        7. Nunca pidas el número de teléfono, ya lo tienes del chat.
        8. Usa la caja abierta disponible. Si hay varias, usa la primera.

        Responde ÚNICAMENTE en JSON:
        {
            "content": "Tu mensaje al usuario...",
            "action": "collect_data" | "create_order",
            "order_data": {
                "client_id": null,
                "client_name": "",
                "client_phone": "",
                "address": "",
                "products": [{ "id": 0, "name": "", "quantity": 0, "price": 0 }],
                "cash_register_id": null,
                "rider_id": 2
            }
        }
        `;

    const aiResponse = await cohereService.chat(systemPrompt, [
      ...history,
      { role: "user", content: message },
    ]);

    console.log(
      "[handleAgendarPedido] Respuesta IA:",
      JSON.stringify(aiResponse),
    );

    if (aiResponse.action === "create_order" && aiResponse.order_data) {
      console.log("[handleAgendarPedido] Creando pedido en el sistema...");
      const order = await externalService.post(
        endpoints.create,
        auth,
        aiResponse.order_data,
      );
      return {
        action: "message",
        content: `¡Pedido registrado con éxito! Tu número de pedido es #${order.id || order.data?.id || "N/A"}. Te avisaremos cuando salga a entrega. 🚀`,
        data: order,
      };
    }

    return { action: "message", content: aiResponse.content };
  } catch (error) {
    console.error("[handleAgendarPedido] Error:", error.message);
    return {
      action: "message",
      content:
        "Tuve un problema al procesar tu pedido. ¿Podrías intentarlo de nuevo?",
    };
  }
}

async function handleDarSeguimiento(accountConfig, history, message, data) {
  const { auth, endpoints } = accountConfig.permissions.dar_seguimiento;
  const { role, prompt, context } = accountConfig.agent;

  try {
    const saleId = data?.sale_id;

    if (!saleId) {
      return {
        action: "message",
        content:
          "Entiendo que quieres saber el estado de tu pedido. ¿Me podrías dar tu número de pedido?",
      };
    }

    const url = endpoints.status.replace(":sale_id", saleId);
    const status = await externalService.get(url, auth);

    const systemPrompt = `
        ROL: ${role}
        CONTEXTO DE LA EMPRESA: ${prompt}
        TONO DE RESPUESTA: ${context}

        Informa al usuario el estado de su pedido de forma clara y amable.
        ESTADO DEL PEDIDO: ${JSON.stringify(status)}

        Responde ÚNICAMENTE en JSON:
        {
            "content": "Tu mensaje informando el estado...",
            "action": "message"
        }
        `;

    const aiResponse = await cohereService.chat(systemPrompt, [
      { role: "user", content: message },
    ]);

    return { action: "message", content: aiResponse.content, data: status };
  } catch (error) {
    console.error("[handleDarSeguimiento] Error:", error.message);
    return {
      action: "message",
      content:
        "No pude obtener el estado de tu pedido en este momento. ¿Podrías indicarme tu número de pedido?",
    };
  }
}

async function handleCancelarPedido(accountConfig, history, message, data) {
  const { auth, endpoints } = accountConfig.permissions.cancelar_pedido;

  try {
    const saleId = data?.sale_id;

    if (!saleId) {
      return {
        action: "message",
        content:
          "Lamento que desees cancelar tu pedido. ¿Podrías indicarme el número de pedido y el motivo?",
      };
    }

    const url = endpoints.cancel.replace(":sale_id", saleId);
    const result = await externalService.post(url, auth, {
      reason: data?.reason || "Cancelado por el cliente",
    });

    return {
      action: "message",
      content: `Tu pedido #${saleId} ha sido cancelado correctamente. Lamentamos los inconvenientes.`,
      data: result,
    };
  } catch (error) {
    console.error("[handleCancelarPedido] Error:", error.message);
    return {
      action: "message",
      content:
        "No pude procesar la cancelación en este momento. Por favor comunícate con nosotros directamente.",
    };
  }
}

module.exports = {
  handleResponder,
  handleConsultarProductos,
  handleAgendarPedido,
  handleDarSeguimiento,
  handleCancelarPedido,
};
