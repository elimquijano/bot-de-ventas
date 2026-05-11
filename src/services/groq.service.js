const axios = require('axios');
const config = require('../config/envs');

class GroqService {
    constructor() {
        this.apiKey = config.GROQ_API_KEY;
        this.model = config.GROQ_MODEL;
        this.apiUrl = 'https://api.groq.com/openai/v1/chat/completions';
    }

    async chat(systemPrompt, history) {
        try {
            const response = await axios.post(this.apiUrl, {
                messages: [{ role: 'system', content: systemPrompt }, ...history],
                model: this.model,
                temperature: 0, // CERO para evitar inventos de precios
                response_format: { type: "json_object" }
            }, {
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }
            });

            const content = response.data.choices[0].message.content;
            console.log('[GroqService] Respuesta cruda:', content);
            return JSON.parse(content);
        } catch (error) {
            console.error('[GroqService] Error:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new GroqService();
