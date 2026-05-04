require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    COHERE_API_KEY: process.env.COHERE_API_KEY,
    COHERE_MODEL: process.env.COHERE_MODEL || 'command-a-03-2025',
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN,
    ADMIN_API_BASE_URL: process.env.ADMIN_API_BASE_URL,
    ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
    WHATSAPP_API_BASE_URL: process.env.WHATSAPP_API_BASE_URL,
    DB_PATH: process.env.DB_PATH || './db/chats',
    MAX_MEMORY: parseInt(process.env.MAX_MEMORY) || 10,
    ADMIN_PHONE: process.env.ADMIN_PHONE || '51900404706'
};
