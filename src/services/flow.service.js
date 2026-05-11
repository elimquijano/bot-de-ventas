const storageService = require('./storage.service');
const externalService = require('./external.service');
const groqService = require('./groq.service');

class FlowService {
    async execute(inputData, whatsappToken) {
        try {
            const input = this.normalizeInput(inputData);
            console.log('[FlowService] Entrada normalizada:', input);

            if (input.isStatus || (!input.text && input.type === 'text')) {
                console.log('[FlowService] Mensaje ignorado (status o sin texto).');
                return { success: true, ignored: true };
            }

            let { phone, recipient, text, pushName, type, lat, lon, fromMe } = input;
            if (fromMe) {
                console.log('[FlowService] Mensaje enviado por mí, guardando en historial...');
                if (text) await storageService.saveMessage(phone, 'assistant', text);
                return { success: true, fromMe: true };
            }

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
        const body = data.data || {};
        const msg = body.message || {};
        const rawFrom = (body.senderJid || body.from || "").split('@')[0];
        return {
            type: msg.locationMessage ? "location" : "text",
            lat: msg.locationMessage?.degreesLatitude || null,
            lon: msg.locationMessage?.degreesLongitude || null,
            text: msg.conversation || msg.extendedTextMessage?.text || "",
            recipient: (body.senderJid || body.from || ""),
            phone: rawFrom.replace(/\D/g, '').slice(-9),
            pushName: body.pushName || "Cliente",
            fromMe: body.key?.fromMe || false,
            isStatus: (body.key?.remoteJid || "").includes('@status')
        };
    }
}

module.exports = new FlowService();
