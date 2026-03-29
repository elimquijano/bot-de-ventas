const axios = require('axios');
const config = require('../config/envs');

class CohereService {
    constructor() {
        this.api = axios.create({
            baseURL: 'https://api.cohere.ai/v2',
            headers: {
                'Authorization': `Bearer ${config.COHERE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
    }

    async chat(systemPrompt, history) {
        try {
            const body = {
                model: config.COHERE_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...history
                ],
                response_format: { type: 'json_object' },
                temperature: 0.3
            };

            const res = await this.api.post('/chat', body);
            const aiContent = res.data.message.content[0].text;
            return JSON.parse(aiContent);
        } catch (error) {
            console.error('Error calling Cohere:', error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new CohereService();
