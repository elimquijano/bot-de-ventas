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

async function handleAgendarPedido(accountConfig, history, message, data) {
  const { auth, endpoints } = accountConfig.permissions.agendar_pedido;
  const { role, prompt, context } = accountConfig.agent;

  try {
    // 1. OBTENER DATOS DEL SISTEMA EN PARALELO
    const [allClients, cashRegisters, products] = await Promise.all([
      externalService.get(endpoints.check_customer, auth),
      externalService.get(endpoints.cash_registers, auth),
      externalService.get(
        accountConfig.permissions.consultar_productos.endpoints.list,
        auth,
      ),
    ]);

    // 2. EXTRAER TELÉFONO DEL CLIENTE (viene del chat, sin prefijo de país)
    const clientPhone =
      message.match(/\d+/)?.[0] ||
      history.find((h) => h.role === "user")?.content?.match(/\d{9}/)?.[0] ||
      "";

    // Buscar en el historial el número real del cliente (el que usa para chatear)
    const phoneFromHistory = history[0]?.phone || "";

    // 3. BUSCAR CLIENTE POR TELÉFONO — puede haber duplicados
    const matchingClients = allClients.filter((c) => {
      const clientNum = (c.phone || "").replace(/\D/g, "").slice(-9);
      const senderNum = (phoneFromHistory || clientPhone)
        .replace(/\D/g, "")
        .slice(-9);
      return clientNum === senderNum;
    });

    // 4. EXTRAER RIDER DEL CAJERO ABIERTO
    const openCashRegister = cashRegisters[0] || null;
    const riderId = openCashRegister?.opened_by?.id || 2;
    const cashRegisterId = openCashRegister?.id || null;

    // 5. PEDIR AL LLM QUE RECOPILE DATOS Y DECIDA
    const systemPrompt = `
        ROL: ${role}
        CONTEXTO DE LA EMPRESA: ${prompt}
        TONO DE RESPUESTA: ${context}

        Estás procesando un pedido de un cliente que escribe por WhatsApp.

        REGLAS CRÍTICAS:
        1. NUNCA pidas el teléfono al cliente. Ya lo tienes del sistema de chat.
        2. Para la dirección SIEMPRE pide que comparta su ubicación con el botón 📍 de WhatsApp. No aceptes direcciones escritas en texto.
        3. Si en el historial aparece [UBICACIÓN COMPARTIDA: <dirección> | lat=X, lon=Y], ya tienes la dirección y coordenadas. No la vuelvas a pedir.
        4. Revisa el historial completo — producto y cantidad pueden ya estar definidos. No los vuelvas a pedir si ya los tienes.
        5. Si hay múltiples clientes con el mismo teléfono, pregunta al cliente cuál de los nombres es el suyo.
        6. Cuando tengas TODOS los datos (cliente o nombre nuevo, producto, cantidad, ubicación compartida) → action: "create_order".
        7. Si falta algún dato → action: "collect_data" pidiendo solo ese dato.

        CLIENTES ENCONTRADOS CON ESTE NÚMERO:
        ${
          matchingClients.length > 0
            ? JSON.stringify(
                matchingClients.map((c) => ({
                  id: c.id,
                  name: c.name,
                  phone: c.phone,
                  address: c.address,
                })),
              )
            : "[] (cliente nuevo, no registrado)"
        }

        PRODUCTOS DISPONIBLES:
        ${products
          .filter((p) => p.stock > 0)
          .map((p) => `- ID:${p.id} | ${p.name} | S/${p.price}`)
          .join("\n")}

        CAJA ABIERTA: ${openCashRegister ? `ID:${cashRegisterId} - ${openCashRegister.opened_by?.full_name}` : "Sin caja abierta"}

        HISTORIAL DE CONVERSACIÓN:
        ${JSON.stringify(history)}

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

    // 6. SI EL LLM TIENE TODOS LOS DATOS → CONSTRUIR PAYLOAD Y CREAR PEDIDO
    if (aiResponse.action === "create_order" && aiResponse.collected) {
      const collected = aiResponse.collected;

      // Validar que tenemos lo mínimo antes de llamar a la API
      if (!collected.product_id || !collected.lat || !collected.lon) {
        console.warn(
          "[handleAgendarPedido] Faltan datos para crear el pedido:",
          collected,
        );
        return {
          action: "message",
          content:
            aiResponse.content ||
            "Faltan datos para completar el pedido. ¿Puedes verificar el producto y compartir tu ubicación?",
        };
      }

      const now = new Date();
      const scheduledAt = now.toISOString().slice(0, 16);

      // Payload exacto que espera la API
      const orderPayload = {
        phone: (matchingClients[0]?.phone || clientPhone || "")
          .replace(/\D/g, "")
          .slice(-9),
        customer_name:
          collected.client_name || matchingClients[0]?.name || "Cliente",
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

      return {
        action: "message",
        content: `¡Pedido registrado con éxito! 🎉 Tu número de pedido es #${order.id || order.data?.id || "N/A"}. El repartidor ${openCashRegister?.opened_by?.full_name || ""} saldrá en breve. 🚚`,
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

async function handleDarSeguimiento(accountConfig, history, message, data) {
  const { auth, endpoints } = accountConfig.permissions.dar_seguimiento;
  const { role, prompt, context } = accountConfig.agent;

  try {
    // Obtener pedidos pendientes del cliente
    const pendingSales = await externalService.get(endpoints.status, auth);

    const systemPrompt = `
        ROL: ${role}
        CONTEXTO DE LA EMPRESA: ${prompt}
        TONO DE RESPUESTA: ${context}

        El cliente pregunta por el estado de su pedido.
        PEDIDOS PENDIENTES: ${JSON.stringify(pendingSales)}
        HISTORIAL: ${JSON.stringify(history)}

        Identifica el pedido del cliente y comunica su estado de forma clara y amable.
        Si hay varios pedidos, muestra el más reciente.
        Si no hay pedidos pendientes, indícalo.

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

async function handleCancelarPedido(accountConfig, history, message, data) {
  const { auth, endpoints } = accountConfig.permissions.cancelar_pedido;
  const { role, prompt, context } = accountConfig.agent;

  try {
    // Primero obtener los pedidos pendientes para identificar cuál cancelar
    const pendingSales = await externalService.get(
      accountConfig.permissions.dar_seguimiento.endpoints.status,
      auth,
    );

    const systemPrompt = `
        ROL: ${role}
        CONTEXTO DE LA EMPRESA: ${prompt}
        TONO DE RESPUESTA: ${context}

        El cliente quiere cancelar un pedido.
        PEDIDOS PENDIENTES: ${JSON.stringify(pendingSales)}
        HISTORIAL: ${JSON.stringify(history)}

        Identifica qué pedido cancelar. Si hay solo uno, cancélalo directamente.
        Si hay varios, pregunta cuál.
        Si no hay pedidos, indícalo.

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
