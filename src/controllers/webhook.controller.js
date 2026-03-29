const flowService = require('../services/flow.service');
const accounts = require('../config/accounts');

class WebhookController {
    async handleIncoming(req, res) {
        const { id } = req.params; // Captura el ID dinámico de la URL
        
        // 1. Validar que la cuenta existe en accounts.js
        const whatsappToken = accounts[id];
        
        if (!whatsappToken) {
            console.error(`⚠️ Webhook ID no registrado: ${id}`);
            return res.status(404).json({ error: 'Webhook ID not found in configuration' });
        }

        try {
            console.log(`--- Nueva Interacción [Cuenta: ${id}] ---`);
            
            // 2. Ejecutar el flujo inyectando el token específico de este webhook
            await flowService.execute(req.body, whatsappToken);

            return res.status(200).json({ status: 'success' });
        } catch (error) {
            console.error('❌ Webhook Controller Error:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }
}

module.exports = new WebhookController();
