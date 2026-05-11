const storageService = require('./storage.service');
const externalService = require('./external.service');
const groqService = require('./groq.service');

class FlowService {
    async execute(inputData, whatsappToken) {
        try {
            const input = this.normalizeInput(inputData);
            console.log('[FlowService] Entrada normalizada:', input);

            // 1. FILTROS DE SEGURIDAD (Ignorar lo que no sea un mensaje relevante)
            
            // Ignorar si no es un evento de mensaje (si viene el tipo de evento)
            const ignoredEvents = ['presence.update', 'receipt.update', 'messages.update', 'call'];
            if (input.eventType && ignoredEvents.includes(input.eventType)) {
                console.log(`[FlowService] Ignorando evento de sistema: ${input.eventType}`);
                return { success: true, ignored: true };
            }

            // Ignorar estados de WhatsApp
            if (input.isStatus) {
                console.log('[FlowService] Ignorando actualización de estado.');
                return { success: true, ignored: true };
            }

            // Ignorar grupos (normalmente el bot es 1-a-1)
            if (input.isGroup) {
                console.log('[FlowService] Ignorando interacción en grupo.');
                return { success: true, ignored: true };
            }

            // Ignorar si no tiene contenido de mensaje (texto o ubicación)
            if (!input.hasMessage) {
                console.log('[FlowService] No tiene contenido de mensaje, ignorando.');
                return { success: true, ignored: true };
            }

            let { phone, recipient, text, pushName, type, lat, lon, fromMe } = input;

            // 2. GESTIÓN DE MENSAJES PROPIOS (Salientes)
            // Si el mensaje es enviado por "mí" (la cuenta del bot, manual o automáticamente)
            if (fromMe) {
                console.log('[FlowService] Mensaje saliente detectado (manual o del bot), guardando historial...');
                if (text) await storageService.saveMessage(phone, 'assistant', text);
                return { success: true, fromMe: true };
            }

            // Ignorar si es un mensaje de texto vacío (y no es ubicación)
            if (type === 'text' && !text.trim()) {
                console.log('[FlowService] Mensaje de texto vacío, ignorando.');
                return { success: true, ignored: true };
            }

            console.log('[FlowService] Procesando mensaje entrante de:', phone);
            console.log('[FlowService] Obteniendo datos externos (productos, clientes, etc)...');
            const [allProducts, allClients, allPendingSales, openRegisters] = await Promise.all([
                externalService.getProducts(),
                externalService.getClients(),
                externalService.getPendingSales(),
                externalService.getOpenCashRegisters()
            ]);

            let mapAddress = null;
            if (type === 'location' && lat && lon) {
                console.log(`[FlowService] Procesando ubicación: ${lat}, ${lon}`);
                mapAddress = await externalService.getReverseGeocoding(lat, lon);
                console.log('[FlowService] Dirección obtenida:', mapAddress);
            }

            const existingClient = allClients.find(c => c.phone && (c.phone.includes(phone) || phone.includes(c.phone)));
            const pendingSale = allPendingSales.find(s => 
                (s.delivery_phone && (s.delivery_phone.includes(phone) || phone.includes(s.delivery_phone))) || 
                (s.client && s.client.phone && (s.client.phone.includes(phone) || phone.includes(s.client.phone)))
            );

            const availableProducts = allProducts.filter(p => p.stock > 0);
            const finalAddr = mapAddress || existingClient?.address || pendingSale?.address || "No especificada";
            const finalName = existingClient?.name || (mapAddress ? `Cliente de ${mapAddress}` : pushName);
            const history = await storageService.getChatHistory(phone);
            const userContent = type === 'location' ? `[UBICACIÓN GPS: ${mapAddress || 'Confirmada'}]` : text;

            console.log(`[FlowService] Historial encontrado: ${history.length} mensajes.`);

            const systemPrompt = `ACTÚA COMO AGENTE DE VENTAS DE JGAS HUÁNUCO. 🛵

DATOS REALES DEL SISTEMA (PROHIBIDO INVENTAR):
- PRODUCTOS: ${availableProducts.map(p => `${p.name} S/${p.price} (ID:${p.id})`).join(', ')}
- CLIENTE: ${finalName}
- DIRECCIÓN: ${finalAddr}
- PEDIDO PENDIENTE: ${pendingSale ? `SÍ, ID:${pendingSale.id}, Dirección:${pendingSale.address}` : 'NO'}

REGLAS DE ORO:
1. SILENCIO: Si el mensaje no es para comprar, preguntar precio o ver un pedido, pon "should_respond": false.
2. UBICACIÓN SOLA: Si envía ubicación pero el historial está vacío (no pidió nada antes), pon "should_respond": false.
3. PRECIOS: Si pregunta precio de 10kg, dale el precio del producto que diga "10kg" más barato (S/49.00). No menciones el de S/10 (es agua).
4. REGISTRO: Si el historial muestra que quería gas y ahora mandó ubicación, marca "is_ready": true y elige el p_id correcto.

RESPONDE SOLO EN JSON:
{
  "thought": "Análisis de historial y decisión",
  "reply": "Mensaje amable con emojis",
  "should_respond": true/false,
  "is_ready": true/false,
  "order": { "p_id": (id), "qty": (cantidad), "total_amount": (total), "customer_name": "${finalName}", "addr": "${finalAddr}" }
}`;

            console.log('[FlowService] Llamando a IA...');
            const aiResponse = await groqService.chat(systemPrompt, history.concat([{ role: 'user', content: userContent }]));
            console.log('[FlowService] Respuesta de IA:', JSON.stringify(aiResponse, null, 2));

            if (aiResponse.should_respond === false) {
                console.log('[FlowService] IA decidió NO responder.');
                await storageService.saveMessage(phone, 'user', userContent);
                return { success: true, ignored: true, thought: aiResponse.thought };
            }

            if (aiResponse.is_ready && aiResponse.order?.p_id) {
                console.log('[FlowService] Registrando pedido en el sistema...');
                let riderId = 2;
                if (openRegisters.length > 0) {
                    const reg = openRegisters[Math.floor(Math.random() * openRegisters.length)];
                    if (reg.opened_by) riderId = reg.opened_by.id;
                }
                const res = await externalService.registerOrder({
                    phone, customer_name: aiResponse.order.customer_name, address: aiResponse.order.addr,
                    product_id: aiResponse.order.p_id, quantity: aiResponse.order.qty || 1, 
                    total_amount: aiResponse.order.total_amount, rider_id: riderId,
                    notes: "Registrado por JGas Bot", discount: 0
                });
                console.log('[FlowService] Resultado de registro de pedido:', res);
                if (res && !res.error) {
                    await storageService.clearHistory(phone);
                    aiResponse.reply += "\n\n✅ ¡Listo! Ya registré tu pedido. 🛵💨";
                }
            } else {
                await storageService.saveMessage(phone, 'user', userContent);
            }

            console.log(`[FlowService] Enviando mensaje a WhatsApp (${recipient})...`);
            await storageService.saveMessage(phone, 'assistant', aiResponse.reply);
            if (whatsappToken && whatsappToken !== 'TEST_TOKEN') {
                const sendResult = await externalService.sendWhatsAppMessage(recipient, aiResponse.reply, whatsappToken);
                console.log('[FlowService] Resultado del envío:', sendResult);
            } else {
                console.log('[FlowService] WhatsApp omitido (Token de prueba o no proporcionado).');
            }

            return { success: true, response: aiResponse.reply, thought: aiResponse.thought, fullResponse: aiResponse };
        } catch (error) {
            console.error('[FlowService] ERROR CRÍTICO:', error);
            throw error;
        }
    }

    normalizeInput(data) {
        // 1. Identificar la estructura de la data (Evolution API, Baileys o similar)
        const eventType = data.event || data.type || null;
        let body = data.data || data || {};
        
        // Si data.data es un array (común en Baileys/Evolution), tomamos el primer elemento
        if (Array.isArray(body)) {
            body = body[0];
        } else if (body.messages && Array.isArray(body.messages)) {
            body = body.messages[0];
        }

        const msg = body.message || {};
        const key = body.key || {};

        // 2. Extraer el JID remoto (la otra parte de la conversación)
        const remoteJid = key.remoteJid || body.remoteJid || body.from || body.senderJid || "";
        
        // 3. Identificar si es un mensaje saliente (enviado por la cuenta oficial)
        // Probamos varias formas comunes en diferentes APIs
        const fromMe = 
            key.fromMe === true || 
            body.fromMe === true || 
            data.fromMe === true ||
            eventType === 'message.sent' || 
            eventType === 'send.message' ||
            body.isOutbound === true;

        // 4. Extraer texto de múltiples fuentes posibles
        const text = msg.conversation || 
                     msg.extendedTextMessage?.text || 
                     msg.imageMessage?.caption || 
                     msg.videoMessage?.caption || 
                     msg.buttonsResponseMessage?.selectedButtonId || 
                     msg.listResponseMessage?.singleSelectReply?.selectedRowId || 
                     body.text || 
                     "";

        // 5. Limpiar el número de teléfono
        const rawFrom = remoteJid.split('@')[0];
        const phone = rawFrom.replace(/\D/g, '').slice(-9);

        return {
            eventType,
            type: msg.locationMessage ? "location" : "text",
            lat: msg.locationMessage?.degreesLatitude || null,
            lon: msg.locationMessage?.degreesLongitude || null,
            text: text,
            recipient: remoteJid,
            phone: phone,
            pushName: body.pushName || "Cliente",
            fromMe: fromMe,
            isStatus: remoteJid.includes('@status'),
            isGroup: remoteJid.includes('@g.us'),
            hasMessage: !!(body.message || body.text || msg.locationMessage || msg.extendedTextMessage)
        };
    }
}

module.exports = new FlowService();
