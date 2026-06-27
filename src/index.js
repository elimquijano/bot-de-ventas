const express = require('express');
const bodyParser = require('body-parser');
const config = require('./config/envs');
const webhookRoutes = require('./routes/webhook.routes');
const accounts = require('./config/accounts');

const app = express();

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

app.get('/health', (req, res) => res.json({ status: 'active', bot: 'Multi-Account Bot' }));

app.use('/webhooks', webhookRoutes);

app.listen(config.PORT, () => {
    console.log(`================================================`);
    console.log(`🚀 BOT WHATSAPP - MULTI-CUENTA`);
    console.log(`✅ Puerto: ${config.PORT}`);
    console.log(`💾 Memoria guardada en: ${config.DB_PATH}`);
    console.log(`📡 Cuentas registradas:`);
    Object.entries(accounts).forEach(([phone, account]) => {
        console.log(`   - ${phone} → ${account.name} [${account.input_channel.type}]`);
        console.log(`     Webhook: ${account.input_channel.webhook_url}`);
    });
    console.log(`================================================`);
});