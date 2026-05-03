const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require('../config/envs');

class GeminiService {
    constructor() {
        this.genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    }

    async chat(systemPrompt, history, media = null) {
        try {
            const model = this.genAI.getGenerativeModel({
                model: config.GEMINI_MODEL,
                systemInstruction: systemPrompt,
            });

            // Convertir historial y asegurar que empiece con 'user'
            let contents = history.map(msg => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }],
            }));

            // Gemini requiere que el historial empiece con 'user'
            while (contents.length > 0 && contents[0].role !== 'user') {
                contents.shift();
            }

            // Extraer el último mensaje para enviarlo por separado
            const lastMessage = contents.pop();
            const lastText = lastMessage ? lastMessage.parts[0].text : "Hola";

            const chatSession = model.startChat({
                history: contents,
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.2, // Menor temperatura para evitar inventos
                },
            });

            let messageParts = [];
            if (media) {
                messageParts.push({
                    inlineData: { data: media.data, mimeType: media.mimeType }
                });
                if (media.text || lastText) messageParts.push({ text: media.text || lastText });
            } else {
                messageParts.push({ text: lastText });
            }

            const result = await chatSession.sendMessage(messageParts);
            const response = await result.response;
            const text = response.text();
            
            return JSON.parse(text);
        } catch (error) {
            console.error('Error calling Gemini:', error.message);
            throw error;
        }
    }
}

module.exports = new GeminiService();
