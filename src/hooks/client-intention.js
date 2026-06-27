const cohereService = require('../services/cohere.service');
const fs = require('fs');
const path = require('path');

/**
 * Determina si un mensaje entrante requiere intervención (respuesta o acción) basándose en el historial.
 * @param {Array} history - Historial de mensajes previos [{role: 'user'|'assistant', content: string}]
 * @param {string} newMessage - El nuevo mensaje del usuario
 * @returns {Promise<Object>} - { intention: 'interested' | 'not_interested', reason: string }
 * 'interested' -> REQUIERE INTERVENCIÓN. 'not_interested' -> NO REQUIERE INTERVENCIÓN.
 */
async function checkIntention(history, newMessage) {
    const systemPrompt = `
    Eres un nodo de decisión lógica en un sistema de chat automatizado.
    Tu objetivo es determinar si un mensaje del usuario REQUIERE una respuesta o acción (intervención), o si debe ser ignorado por ser irrelevante, un cierre de ciclo, o ruido.

    CRITERIOS DE INTERVENCIÓN (interested):
    - El mensaje inicia una conversación (saludos).
    - El mensaje contiene una pregunta, duda o petición de información.
    - El mensaje es una respuesta directa a una pregunta previa del sistema que permite continuar un proceso.
    - El mensaje expresa un interés, intención de compra, o solicitud de servicio.
    - El mensaje requiere una aclaración o corrección.

    CRITERIOS DE NO INTERVENCIÓN (not_interested):
    - El mensaje es ruido irrelevante que no tiene relación con el propósito de una interacción comercial/asistencial (ej: comentarios aleatorios sobre el clima sin contexto previo).
    - El mensaje es un cierre de cortesía (gracias, ok, listo) después de que el objetivo de la conversación ya se cumplió.
    - El mensaje es una despedida final.
    - El usuario está hablando consigo mismo o enviando contenido sin sentido para el flujo.

    REGLA DE CONTEXTO:
    - Evalúa el historial para saber si el mensaje actual es la continuación necesaria de un flujo abierto.
    - Si el mensaje actual rompe el contexto de forma absurda o no solicita nada, no intervengas.

    Responde ESTRICTAMENTE en JSON:
    {
        "intention": "interested" | "not_interested",
        "reason": "Explicación lógica de la decisión basada en la necesidad de respuesta"
    }
    `;

    const messages = [
        ...history,
        { role: 'user', content: newMessage }
    ];

    try {
        const result = await cohereService.chat(systemPrompt, messages);
        return result;
    } catch (error) {
        console.error('[checkIntention] Error:', error.message);
        return { intention: 'interested', reason: 'Error en el análisis, se asume intervención por seguridad' };
    }
}

module.exports = { checkIntention };