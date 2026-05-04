const storageService = require('./storage.service');
const externalService = require('./external.service');
const groqService = require('./groq.service');

class FlowService {
    async execute(inputData, whatsappToken) {
        try {
            const input = this.normalizeInput(inputData);
            if (input.isStatus || (!input.text && input.type === 'text')) return { success: true, ignored: true };

            let { phone, recipient, text, pushName, type, lat, lon, fromMe } = input;
            if (fromMe) {
                if (text) await storageService.saveMessage(phone, 'assistant', text);
                return { success: true, fromMe: true };
            }

            const [allProducts, allClients, allPendingSales, openRegisters] = await Promise.all([
                externalService.getProducts(),
                externalService.getClients(),
                externalService.getPendingSales(),
                externalService.getOpenCashRegisters()
            ]);

            let mapAddress = null;
            if (type === 'location' && lat && lon) {
                mapAddress = await externalService.getReverseGeocoding(lat, lon);
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

            const aiResponse = await groqService.chat(systemPrompt, history.concat([{ role: 'user', content: userContent }]));

            if (aiResponse.should_respond === false) {
                await storageService.saveMessage(phone, 'user', userContent);
                return { success: true, ignored: true, thought: aiResponse.thought };
            }

            if (aiResponse.is_ready && aiResponse.order?.p_id) {
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
                if (res && !res.error) {
                    await storageService.clearHistory(phone);
                    aiResponse.reply += "\n\n✅ ¡Listo! Ya registré tu pedido. 🛵💨";
                }
            } else {
                await storageService.saveMessage(phone, 'user', userContent);
            }

            await storageService.saveMessage(phone, 'assistant', aiResponse.reply);
            if (whatsappToken && whatsappToken !== 'TEST_TOKEN') {
                await externalService.sendWhatsAppMessage(recipient, aiResponse.reply, whatsappToken);
            }

            return { success: true, response: aiResponse.reply, thought: aiResponse.thought, fullResponse: aiResponse };
        } catch (error) {
            console.error('Error:', error);
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
