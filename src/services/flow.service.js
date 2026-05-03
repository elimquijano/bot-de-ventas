const storageService = require('./storage.service');
const externalService = require('./external.service');
const geminiService = require('./gemini.service');
const config = require('../config/envs');

class FlowService {
    async execute(inputData, whatsappToken) {
        try {
            const input = this.normalizeInput(inputData);
            if (input.isStatus || (!input.text && input.type === 'text' && !input.media)) {
                return { success: true, ignored: true };
            }

            let { phone, recipient, text, pushName, type, lat, lon, fromMe, media, mediaKey, mimeType } = input;

            if (fromMe) {
                if (text) await storageService.saveMessage(phone, 'assistant', text);
                return { success: true, fromMe: true };
            }

            // 1. OBTENER DATA REAL
            const [allProducts, allClients, allPendingSales, openRegisters] = await Promise.all([
                externalService.getProducts(),
                externalService.getClients(),
                externalService.getPendingSales(),
                externalService.getOpenCashRegisters()
            ]);

            const availableProducts = allProducts.filter(p => p.stock > 0);
            const existingClient = allClients.find(c => c.phone && c.phone.includes(phone));
            const pendingSale = allPendingSales.find(s => 
                (s.delivery_phone && s.delivery_phone.includes(phone)) || 
                (s.client && s.client.phone && s.client.phone.includes(phone))
            );

            // 2. MAPBOX / UBICACIÓN
            let mapAddress = null;
            if (type === 'location' && lat && lon) {
                mapAddress = await externalService.getReverseGeocoding(lat, lon);
            }

            // 3. CONSOLIDACIÓN
            let finalLat = lat || (existingClient ? existingClient.latitude : null);
            let finalLon = lon || (existingClient ? existingClient.longitude : null);
            let finalAddr = mapAddress || (existingClient ? existingClient.address : (pendingSale ? pendingSale.address : "No especificada"));
            let finalName = existingClient ? existingClient.name : (pushName || "Campeón/a");

            // Pasamos los productos como contexto, pero el bot decidirá qué mostrar
            const productsContext = availableProducts.map(p => `ID:${p.id} | ${p.name} | S/${p.price}`).join('\n');

            // 4. MEMORIA
            const history = await storageService.getChatHistory(phone);
            const messageContent = media ? `[Envió ${type}] ${text || ''}` : text;
            history.push({ role: 'user', content: messageContent });
            await storageService.saveMessage(phone, 'user', messageContent);

            // 5. PROMPT CON PERSONALIDAD (EMOJIS + INTELIGENCIA)
            const systemPrompt = `Eres JGas Bot, el alma de JGas Huánuco. ✨
Tu misión: Atender con una sonrisa (emojis), ser ultra eficiente y cerrar ventas.

PERSONALIDAD:
- ¡Usa emojis! 🛵, 🔥, ✨, ✅, 🙏, 😊, 📍.
- No eres un robot. Eres un asesor que ayuda a un amigo.
- Si el cliente te saluda, salúdalo con alegría: "¡Hola ${finalName}! Qué gusto tenerte por aquí. ✨".

INTELIGENCIA DE PRODUCTO (DATOS REALES):
Usa esta lista SOLO como referencia interna. NO la leas toda si no es necesario:
${productsContext}

REGLAS DE ORO:
1. FILTRADO: Si el cliente pide un tipo de gas (ej. "plomo"), dale el precio de ese específico. No le satures con otros.
2. PRECIOS: Sé exacto con los precios de arriba. Si pide rebaja, dile que nuestro gas rinde más y es el más seguro de Huánuco. ✨
3. NEGOCIACIÓN PRO: Solo si es negocio o lleva más de 3, puedes bajar un par de soles. Si insiste mucho, el tope es S/5 de descuento, pero hazlo sentir como un regalo especial. 😉
4. UBICACIÓN: Si no sabes dónde enviarlo, pídela con cariño: "Amigo/a, para que el motorizado llegue volando, pásame tu ubicación con el clip 📎 de WhatsApp. ¡Así no nos perdemos! 📍🛵".
5. PEDIDOS EN CURSO: Si ya tiene un pedido (${pendingSale ? 'ID '+pendingSale.id : 'Ninguno'}), dile: "¡Tranqui! Tu pedido ya está en manos del motorizado y está por llegar. 🛵💨 Porfa, estate atento a tu cel que te llamará al estar afuera. 🙏😊".

RESPONDE SIEMPRE EN JSON:
{
  "reply": "Tu mensaje encantador con emojis aquí...",
  "should_respond": true,
  "is_ready": true/false (solo si tienes p_id, qty y ubicación real),
  "order": {
    "p_id": (id),
    "qty": (cantidad),
    "discount": (descuento unitario),
    "total_amount": (total calculado),
    "customer_name": "${finalName}",
    "addr": "${finalAddr}",
    "lat": ${finalLat || 'null'},
    "lon": ${finalLon || 'null'},
    "notes": "Algo que el repartidor deba saber"
  }
}`;

            // 6. LLAMAR A GEMINI
            const aiResponse = await geminiService.chat(systemPrompt, history, media);

            // 7. ASIGNACIÓN Y PROCESAMIENTO
            if (aiResponse.is_ready) {
                let riderId = 2; // Default
                if (openRegisters.length > 0) {
                    riderId = openRegisters[Math.floor(Math.random() * openRegisters.length)].opened_by.id;
                }

                await externalService.registerOrder({
                    phone: phone,
                    customer_name: aiResponse.order.customer_name,
                    address: aiResponse.order.addr,
                    latitude: aiResponse.order.lat,
                    longitude: aiResponse.order.lon,
                    product_id: aiResponse.order.p_id,
                    quantity: aiResponse.order.qty,
                    total_amount: aiResponse.order.total_amount,
                    discount: aiResponse.order.discount * aiResponse.order.qty,
                    notes: aiResponse.order.notes,
                    rider_id: riderId
                });
                await storageService.clearHistory(phone);
                aiResponse.reply += "\n\n✅ ¡Pedido confirmado! Tu gas ya va en camino. 🛵💨";
            }

            await storageService.saveMessage(phone, 'assistant', aiResponse.reply);
            
            if (whatsappToken && whatsappToken !== 'TEST_TOKEN') {
                await externalService.sendWhatsAppMessage(recipient, aiResponse.reply, whatsappToken);
            }

            return { success: true, response: aiResponse.reply, fullResponse: aiResponse };
        } catch (error) {
            console.error('Error en FlowService:', error);
            throw error;
        }
    }

    normalizeInput(data) {
        const body = data.data || {};
        const msg = body.message || {};
        const key = body.key || {};
        
        const rawFrom = (body.senderJid || body.from || "").split('@')[0];
        const digits = rawFrom.replace(/\D/g, '');
        const nineDigits = digits.slice(-9);

        return {
            type: msg.locationMessage ? "location" : (msg.imageMessage ? "image" : (msg.audioMessage ? "audio" : "text")),
            lat: msg.locationMessage?.degreesLatitude || null,
            lon: msg.locationMessage?.degreesLongitude || null,
            text: msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || "",
            recipient: digits,
            phone: nineDigits,
            pushName: body.pushName || "Cliente",
            fromMe: key.fromMe || false,
            isStatus: (key.remoteJid || "").includes('@status')
        };
    }
}

module.exports = new FlowService();
