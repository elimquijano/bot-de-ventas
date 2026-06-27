/**
 * Configuración de cuentas y permisos por número de WhatsApp.
 * Esta estructura permite que cada número actúe como un agente independiente con sus propias capacidades.
 */
module.exports = {
  51900000000: {
    name: "Agente de Ventas Sucursal Norte",

    agent: {
      role: "Asistente Virtual de Ventas",
      context: "Tono profesional, servicial y directo.",
      prompt:
        "Eres un asistente experto en atención al cliente. Tu objetivo es ayudar a los usuarios con sus pedidos de forma amable y eficiente.",
    },

    input_channel: {
      type: "whatsapp_baileys",
      webhook_url: "http://url/webhooks/51948079355",
      webhook_secret: "",
    },

    output_channel: {
      type: "whatsapp_baileys",
      api_url: "http://url/api/v1",
      api_token: "token",
    },

    permissions: {
      responder: {
        enabled: true,
      },
      consultar_productos: {
        enabled: true,
        auth: {
          type: "bearer",
          token: "token",
        },
        endpoints: {
          list: "http://url/api/products?per_page=-1",
        },
      },
      agendar_pedido: {
        enabled: false,
        auth: {
          type: "bearer",
          token: "token",
        },
        endpoints: {
          check_customer: "http://url/api/clients?per_page=-1",
          cash_registers: "http://url/api/cash-registers?page=1&status=open",
          create: "http://url/api/sales/quick-order",
        },
      },
      dar_seguimiento: {
        enabled: false,
        auth: {
          type: "bearer",
          token: "token",
        },
        endpoints: {
          status: "http://url/api/sales/:sale_id/status",
        },
      },
      cancelar_pedido: {
        enabled: false,
        auth: {
          type: "bearer",
          token: "token",
        },
        endpoints: {
          cancel: "http://url/api/sales/:sale_id/cancel",
        },
      },
    },
  },
};
