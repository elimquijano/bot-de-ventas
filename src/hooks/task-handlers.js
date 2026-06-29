const cohereService = require("../services/cohere.service");
const externalService = require("../services/external.service");

async function handleResponder(accountConfig, history, message, data, phone) {
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

async function handleConsultarProductos(
  accountConfig,
  history,
  message,
  data,
  phone,
) {
  const { auth, endpoints } = accountConfig.permissions.consultar_productos;
  const { role, prompt, context } = accountConfig.agent;

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

async function handleAgendarPedido(
  accountConfig,
  history,
  message,
  data,
  phone,
) {
  const { auth, endpoints } = accountConfig.permissions.agendar_pedido;
  const { role, prompt, context } = accountConfig.agent;

  try {
    const [allClients, cashRegisters, products] = await Promise.all([
      externalService.get(endpoints.check_customer, auth),
      externalService.get(endpoints.cash_registers, auth),
      externalService.get(
        accountConfig.permissions.consultar_productos.endpoints.list,
        auth,
      ),
    ]);

    const senderShort = phone.replace(/\D/g, "").slice(-9);
    const matchingClients = allClients.filter(
      (c) => (c.phone || "").replace(/\D/g, "").slice(-9) === senderShort,
    );

    const openCashRegister = cashRegisters[0] || null;
    const riderId = openCashRegister?.opened_by?.id || 2;
    const cashRegisterId = openCashRegister?.id || null;

    const systemPrompt = `
        Eres un asistente de ventas procesando un pedido por WhatsApp. Sé amable y directo.

        DATOS YA CONOCIDOS (no volver a pedir):
        - Teléfono del cliente: ${senderShort}
        - Cliente registrado: ${
          matchingClients.length === 1
            ? `Sí → nombre: "${matchingClients[0].name}"`
            : matchingClients.length > 1
              ? `Hay ${matchingClients.length} clientes con este número, preguntar cuál es`
              : "No registrado"
        }

        PRODUCTOS DISPONIBLES:
        ${products
          .filter((p) => p.stock > 0)
          .map((p) => `- ID:${p.id} | ${p.name} | S/${p.price}`)
          .join("\n")}

        CAJA ABIERTA: ${openCashRegister ? "Sí" : "No hay caja abierta"}

        HISTORIAL DE CONVERSACIÓN:
        ${JSON.stringify(history)}

        FLUJO DE RECOPILACIÓN — sigue este orden estricto, pregunta DE A UN DATO POR MENSAJE:
        1. Producto → si no está en el historial, preguntar cuál quiere.
        2. Cantidad → si no está en el historial, preguntar cuántos.
        3. Ubicación → si no hay [UBICACIÓN COMPARTIDA: ...] en el historial, pedir que use el botón 📍 de WhatsApp. NUNCA aceptes dirección escrita en texto.
        4. Confirmación → resumir el pedido y pedir confirmación.
        5. Cuando el cliente confirme y tengas producto + cantidad + ubicación compartida → action: "create_order".

        REGLAS:
        - Un solo dato por mensaje. No preguntes producto Y cantidad Y ubicación en el mismo mensaje.
        - NUNCA ofrezcas descuentos. Los precios son fijos. Si el cliente pide rebaja, responde amablemente que el precio es fijo.
        - NUNCA menciones nombres de repartidores, IDs, cajas ni datos internos del sistema.
        - Si hay [UBICACIÓN COMPARTIDA: <dirección> | lat=X, lon=Y] en el historial, ya tienes la dirección. No la pidas de nuevo.
        - "collected.client_name": usa el nombre del cliente registrado si existe, si no deja vacío (el sistema lo completará).

        Responde ÚNICAMENTE en JSON:
        {
            "content": "Tu mensaje al usuario...",
            "action": "collect_data" | "create_order" | "ask_client_selection",
            "collected": {
                "client_id": null,
                "client_name": "",
                "product_id": null,
                "product_name": "",
                "quantity": 1,
                "unit_price": 0,
                "address": "",
                "lat": null,
                "lon": null
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

    if (aiResponse.action === "create_order" && aiResponse.collected) {
      const collected = aiResponse.collected;

      if (!collected.product_id || !collected.lat || !collected.lon) {
        console.warn("[handleAgendarPedido] Faltan datos mínimos:", collected);
        return {
          action: "message",
          content:
            aiResponse.content ||
            "Faltan datos para completar el pedido. ¿Puedes verificar el producto y compartir tu ubicación?",
        };
      }

      // Resolver customer_name: cliente registrado > mencionado en chat > primera parte de dirección Mapbox
      const customerName =
        collected.client_name ||
        matchingClients[0]?.name ||
        (collected.address
          ? collected.address.split(",")[0].trim()
          : "Cliente");

      const now = new Date();
      const scheduledAt = now.toISOString().slice(0, 16);

      const orderPayload = {
        phone: senderShort,
        customer_name: customerName,
        address: collected.address,
        latitude: collected.lat,
        longitude: collected.lon,
        product_id: collected.product_id,
        quantity: collected.quantity || 1,
        total_amount: (collected.unit_price || 0) * (collected.quantity || 1),
        discount: 0,
        rider_id: riderId,
        notes: "",
        delivery_notes: "",
        scheduled_at: scheduledAt,
      };

      console.log(
        "[handleAgendarPedido] Payload a enviar:",
        JSON.stringify(orderPayload),
      );

      const order = await externalService.post(
        endpoints.create,
        auth,
        orderPayload,
      );
      const orderId = order.id || order.data?.id || "N/A";

      // Usar el content del LLM y solo agregar el número de pedido real al final
      const successContent = `${aiResponse.content}\n\nTu número de pedido es *#${orderId}*. 🚚`;

      return {
        action: "message",
        content: successContent,
        data: order,
      };
    }

    return { action: "message", content: aiResponse.content };
  } catch (error) {
    console.error(
      "[handleAgendarPedido] Error:",
      error.response?.data || error.message,
    );
    return {
      action: "message",
      content:
        "Tuve un problema al procesar tu pedido. ¿Podrías intentarlo de nuevo?",
    };
  }
}

async function handleDarSeguimiento(
  accountConfig,
  history,
  message,
  data,
  phone,
) {
  const { auth, endpoints } = accountConfig.permissions.dar_seguimiento;
  const { role, prompt, context } = accountConfig.agent;

  try {
    const pendingSales = await externalService.get(endpoints.status, auth);
    const senderShort = phone.replace(/\D/g, "").slice(-9);

    const systemPrompt = `
        ROL: ${role}
        CONTEXTO DE LA EMPRESA: ${prompt}
        TONO DE RESPUESTA: ${context}

        El cliente con teléfono ${senderShort} pregunta por el estado de su pedido.
        PEDIDOS PENDIENTES EN EL SISTEMA: ${JSON.stringify(pendingSales)}
        HISTORIAL: ${JSON.stringify(history)}

        Busca en los pedidos pendientes si hay alguno cuyo teléfono coincida con ${senderShort}.
        Informa el estado de forma clara y amable.
        Si no hay pedidos para ese número, indícalo.

        Responde ÚNICAMENTE en JSON:
        {
            "content": "Tu mensaje informando el estado...",
            "action": "message"
        }
        `;

    const aiResponse = await cohereService.chat(systemPrompt, [
      ...history,
      { role: "user", content: message },
    ]);

    return {
      action: "message",
      content: aiResponse.content,
      data: pendingSales,
    };
  } catch (error) {
    console.error("[handleDarSeguimiento] Error:", error.message);
    return {
      action: "message",
      content:
        "No pude obtener el estado de tu pedido en este momento. Por favor intenta de nuevo.",
    };
  }
}

async function handleCancelarPedido(
  accountConfig,
  history,
  message,
  data,
  phone,
) {
  const { auth, endpoints } = accountConfig.permissions.cancelar_pedido;
  const { role, prompt, context } = accountConfig.agent;

  try {
    const pendingSales = await externalService.get(
      accountConfig.permissions.dar_seguimiento.endpoints.status,
      auth,
    );
    const senderShort = phone.replace(/\D/g, "").slice(-9);

    const systemPrompt = `
        ROL: ${role}
        CONTEXTO DE LA EMPRESA: ${prompt}
        TONO DE RESPUESTA: ${context}

        El cliente con teléfono ${senderShort} quiere cancelar un pedido.
        PEDIDOS PENDIENTES EN EL SISTEMA: ${JSON.stringify(pendingSales)}
        HISTORIAL: ${JSON.stringify(history)}

        Busca pedidos cuyo teléfono coincida con ${senderShort}.
        Si hay solo uno, cancélalo directamente → action: "cancel".
        Si hay varios, pregunta cuál → action: "ask_which".
        Si no hay pedidos para ese número → action: "no_orders".

        Responde ÚNICAMENTE en JSON:
        {
            "content": "Tu mensaje al usuario...",
            "action": "cancel" | "ask_which" | "no_orders",
            "sale_id": null
        }
        `;

    const aiResponse = await cohereService.chat(systemPrompt, [
      ...history,
      { role: "user", content: message },
    ]);

    console.log(
      "[handleCancelarPedido] Respuesta IA:",
      JSON.stringify(aiResponse),
    );

    if (aiResponse.action === "cancel" && aiResponse.sale_id) {
      const url = endpoints.cancel.replace(":sale_id", aiResponse.sale_id);
      const result = await externalService.post(url, auth, {});

      return {
        action: "message",
        content: `Tu pedido #${aiResponse.sale_id} ha sido cancelado correctamente. Lamentamos los inconvenientes. 😔`,
        data: result,
      };
    }

    return { action: "message", content: aiResponse.content };
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
