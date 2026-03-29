const express = require('express');
const bodyParser = require('body-parser');
const config = require('./config/envs');
const webhookRoutes = require('./routes/webhook.routes');

const app = express();

// Middlewares
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Health Check
app.get('/health', (req, res) => res.json({ status: 'active', bot: 'JGas Multi-Account Bot' }));

// Configuración de Rutas de Webhooks (Cambiado de /api a /webhooks)
app.use('/webhooks', webhookRoutes);

// Iniciar el Servidor
app.listen(config.PORT, () => {
    console.log(`================================================`);
    console.log(`🚀 BOT WHATSAPP JGAS - MULTI-CUENTA`);
    console.log(`✅ Puerto: ${config.PORT}`);
    console.log(`💾 Memoria guardada en: ${config.DB_PATH}`);
    console.log(`================================================`);
});
