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

    const systemPrompt = `
        Eres un asistente de ventas. El usuario pregunta por productos.
        PRODUCTOS DISPONIBLES: ${availableProducts.map((p) => `${p.name} S/${p.price}`).join(", ")}
        
        Responde al usuario mostrándole las opciones disponibles de forma atractiva.
        
        Responde ÚNICAMENTE en JSON:
        {
            "content": "Tu respuesta con la lista de productos...",
            "action": "list_products"
        }
        `;

    const aiResponse = await cohereService.chat(systemPrompt, [
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

  try {
    const [clients, cashRegisters] = await Promise.all([
      externalService.get(endpoints.check_customer, auth),
      externalService.get(endpoints.cash_registers, auth),
    ]);

    const systemPrompt = `
        Eres un asistente de ventas procesando un pedido.
        CLIENTES REGISTRADOS: ${JSON.stringify(clients.map((c) => ({ id: c.id, name: c.name, phone: c.phone })))}
        CAJAS ABIERTAS: ${JSON.stringify(cashRegisters.map((c) => ({ id: c.id, name: c.name })))}
        HISTORIAL: ${JSON.stringify(history)}

        Tu objetivo es recopilar la información necesaria para crear un pedido:
        - Identificar si el cliente ya está registrado por su número de teléfono.
        - Si no está registrado, pedir nombre y dirección.
        - Confirmar los productos y cantidades.
        - Cuando tengas toda la información, indicar action: "create_order" con los datos listos.

        Responde ÚNICAMENTE en JSON:
        {
            "content": "Tu mensaje al usuario...",
            "action": "collect_data" | "create_order",
            "order_data": { "client_id": null, "client_name": "", "address": "", "products": [], "cash_register_id": null }
        }
        `;

    const aiResponse = await cohereService.chat(systemPrompt, [
      ...history,
      { role: "user", content: message },
    ]);

    if (aiResponse.action === "create_order" && aiResponse.order_data) {
      const order = await externalService.post(endpoints.create, auth, {
        ...aiResponse.order_data,
        rider_id: aiResponse.order_data.rider_id || 2,
      });
      return {
        action: "message",
        content: `¡Pedido registrado con éxito! Tu número de pedido es #${order.id || "N/A"}. Te avisaremos cuando salga a entrega.`,
        data: order,
      };
    }

    return { action: "message", content: aiResponse.content };
  } catch (error) {
    console.error("[handleAgendarPedido] Error:", error.message);
    return {
      action: "message",
      content:
        "¡Excelente! Para agendar tu pedido necesito tu dirección exacta y el producto que deseas. ¿Me los podrías confirmar?",
    };
  }
}

async function handleDarSeguimiento(accountConfig, history, message, data) {
  const { auth, endpoints } = accountConfig.permissions.dar_seguimiento;

  try {
    const saleId = data?.sale_id;

    if (!saleId) {
      return {
        action: "message",
        content:
          "Entiendo que quieres saber el estado de tu pedido. ¿Me podrías dar tu número de pedido o DNI?",
      };
    }

    const url = endpoints.status.replace(":sale_id", saleId);
    const status = await externalService.get(url, auth);

    const systemPrompt = `
        Eres un asistente de ventas informando el estado de un pedido.
        ESTADO DEL PEDIDO: ${JSON.stringify(status)}

        Informa al usuario de forma clara y amable el estado de su pedido.

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
