const accounts = require("../config/accounts");
const taskHandlers = require("../hooks/task-handlers");
const cohereService = require("./cohere.service");

class OrchestratorService {
  async process(phone, analysis, history, newMessage, accountConfig) {
    if (!accountConfig) {
      console.error(`[Orchestrator] Cuenta ${phone} no configurada.`);
      return { action: "ignore", reason: "Account not configured" };
    }

    if (analysis.intention === "not_interested") {
      console.log(
        `[Orchestrator] Circuito cerrado para ${phone}. Razón: ${analysis.reason}`,
      );
      return { action: "close_loop", reason: analysis.reason };
    }

    console.log(
      `[Orchestrator] Analizando mensaje: "${newMessage}" para ${phone}`,
    );

    const taskToExecute = await this.decideTask(
      accountConfig,
      analysis,
      history,
      newMessage,
    );
    console.log(`[Orchestrator] Tarea decidida: ${taskToExecute.task}`);

    if (accountConfig.permissions[taskToExecute.task]?.enabled) {
      const handlerName = `handle${this.capitalize(taskToExecute.task)}`;
      if (taskHandlers[handlerName]) {
        console.log(`[Orchestrator] Ejecutando handler: ${handlerName}`);
        return await taskHandlers[handlerName](
          accountConfig,
          history,
          newMessage,
          taskToExecute.data,
        );
      } else {
        console.warn(
          `[Orchestrator] Handler ${handlerName} no encontrado en task-handlers.js`,
        );
      }
    } else {
      console.log(
        `[Orchestrator] Tarea "${taskToExecute.task}" no habilitada. Usando fallback "responder".`,
      );
    }

    if (accountConfig.permissions.responder?.enabled) {
      return await taskHandlers.handleResponder(
        accountConfig,
        history,
        newMessage,
      );
    }

    return {
      action: "ignore",
      reason: "No enabled tasks for this intent and responder is disabled",
    };
  }

  async decideTask(accountConfig, analysis, history, newMessage) {
    const availableTasks = Object.keys(accountConfig.permissions).filter(
      (key) => accountConfig.permissions[key].enabled,
    );

    const systemPrompt = `
        Eres el orquestador de un sistema de atención al cliente multi-agente.
        Tu trabajo es elegir la mejor TAREA a ejecutar basándote en el mensaje del usuario y las tareas disponibles.
        
        TAREAS DISPONIBLES:
        ${availableTasks.join(", ")}

        REGLAS DE CLASIFICACIÓN:
        - "responder": Saludos, despedidas, agradecimientos, charlas generales o dudas que no encajen en lo demás.
        - "consultar_productos": Preguntas sobre stock, qué vendes, precios, catálogo o productos específicos.
        - "agendar_pedido": Intención clara de compra, confirmación de pedido o envío de datos para entrega.
        - "dar_seguimiento": Preguntas sobre el estado de un pedido ya realizado.
        - "cancelar_pedido": Solicitud explícita de anular o cancelar una orden.

        Responde ÚNICAMENTE en JSON:
        {
            "task": "nombre_de_la_tarea",
            "reason": "breve explicación de por qué elegiste esta tarea",
            "data": { "llave": "valor_extraido_si_es_necesario" }
        }
        `;

    try {
      const recentHistory = history.slice(-5);
      return await cohereService.chat(systemPrompt, [
        ...recentHistory,
        { role: "user", content: newMessage },
      ]);
    } catch (error) {
      console.error("[Orchestrator.decideTask] Error:", error.message);
      return { task: "responder", data: {}, reason: "Error en clasificación" };
    }
  }

  capitalize(str) {
    return str
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join("");
  }
}

module.exports = new OrchestratorService();
