const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhook.controller');

/**
 * ESTÁNDAR ESCALABLE:
 * Escucha en /webhooks/:id
 * El 'id' se captura dinámicamente y se usa para buscar el token en accounts.js
 * 
 * Ejemplo de URL: http://localhost:3000/webhooks/64f84e8f-5af0-48e5-a09d-8bfba4a93378
 */
router.post('/:id', (req, res) => webhookController.handleIncoming(req, res));

module.exports = router;
