require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    COHERE_API_KEY: process.env.COHERE_API_KEY,
    COHERE_MODEL: process.env.COHERE_MODEL || 'command-r-plus',
    MAPBOX_ACCESS_TOKEN: process.env.MAPBOX_ACCESS_TOKEN,
    ADMIN_API_BASE_URL: process.env.ADMIN_API_BASE_URL,
    ADMIN_API_TOKEN: process.env.ADMIN_API_TOKEN,
    WHATSAPP_API_BASE_URL: process.env.WHATSAPP_API_BASE_URL,
    DB_PATH: process.env.DB_PATH || './db/chats',
    MAX_MEMORY: parseInt(process.env.MAX_MEMORY) || 20
};
