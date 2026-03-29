const storageService = require('./storage.service');
const externalService = require('./external.service');
const cohereService = require('./cohere.service');

class FlowService {
    async execute(inputData, whatsappToken) {
        try {
            // 1. Detectar Entrada (Lógica de n8n)
            const { phone, recipient, text, pushName, type, lat, lon } = this.normalizeInput(inputData);

            // 2. Obtener Datos del Sistema
            const [allProducts, allClients] = await Promise.all([
                externalService.getProducts(),
                externalService.getClients()
            ]);

            const availableProducts = allProducts.filter(p => p.stock > 0);
            const existingClient = allClients.find(c => c.phone && c.phone.includes(phone));

            // 3. Manejo de Ubicación
            let mapAddress = "No enviada";
            if (type === 'location') {
                mapAddress = await externalService.getReverseGeocoding(lat, lon);
            }

            // 4. Consolidar datos de ubicación y nombre
            let finalLat = lat;
            let finalLon = lon;
            let finalAddr = mapAddress;
            let finalName = pushName;
            let clientStatus = "NUEVO";

            if (existingClient) {
                clientStatus = "REGISTRADO";
                finalLat = existingClient.latitude || lat;
                finalLon = existingClient.longitude || lon;
                finalAddr = existingClient.address || mapAddress;
                finalName = existingClient.name || pushName;
            }

            const productsTxt = availableProducts.map(p => `- *${p.name}*: S/${p.price} (ID_Interno:${p.id})`).join('\n');

            // 5. Preparar Fecha de entrega estimada (+30 min)
            const now = new Date();
            now.setMinutes(now.getMinutes() + 30);
            const scheduled_at = now.toISOString().slice(0, 16);

            // 6. Gestionar Memoria
            const history = await storageService.getChatHistory(phone);
            history.push({ role: 'user', content: text });
            
            // Limitar memoria a las últimas 20 interacciones
            await storageService.saveMessage(phone, 'user', text);

            // 7. Preparar System Prompt (Migrado tal cual de n8n)
            const systemPrompt = `Eres JGas Bot, el mejor asesor de ventas. Tienes MEMORIA del chat.

=== REGLAS DE ORO (COMPORTAMIENTO) ===
1. PASO A PASO: Responde SOLO a lo que el cliente dice. 
   - Si dice "Hola", ¡SOLO SALUDA! NO le envíes productos, NO le pidas dirección. Solo dile: "¡Hola ${finalName}! 👋 Bienvenido a JGas. ¿En qué puedo ayudarte hoy? 😊"
   - Si pregunta "¿Qué vendes?" o "Quiero gas", RECIÉN AHÍ envíale la lista de productos.
2. EMOJIS: Sé amable y usa emojis (😊, ✨, 🚚, ✅, 📍, 🔵).
3. NUNCA menciones los "ID_Interno".

=== REGLAS DE NEGOCIACIÓN ===
1. Intenta SIEMPRE vender al precio normal.
2. DESCUENTO 1: Si pide "rebaja" o "nada menos", descuenta 1 o 2 soles.
3. DESCUENTO 2: Si es restaurante, mercado O pide 3 balones o más, descuenta 4 soles.
4. TOTAL: Multiplica (Precio Unitario con/sin descuento) x (Cantidad).

=== ESTADO DEL CLIENTE ===
- Nombre: ${finalName}
- Tipo de Cliente: ${clientStatus}
- Mensaje actual: "${text}"

=== MANEJO DE UBICACIÓN ===
- Si el Tipo de Cliente es REGISTRADO: YA TENEMOS su dirección guardada. NO LE PIDAS GPS NUNCA. Solo ofrécele el producto y confirma el pedido.
- Si es NUEVO y quiere pedir pero NO mandó GPS: Pídele que envíe su ubicación actual con el clip 📎.
- Solo pon "is_ready": true cuando sepas QUÉ PRODUCTO quiere, y ya tengas su GPS (o sea cliente registrado).

=== PRODUCTOS ===
${productsTxt}

=== JSON DE SALIDA OBLIGATORIO ===
{
  "reply": "Tu mensaje aquí, con \\n\\n para saltos de línea y emojis.",
  "is_ready": true/false,
  "order": {
    "p_id": (ID_Interno o null),
    "qty": (Cantidad o 1),
    "discount": (Monto total descontado o 0),
    "total_amount": (Monto final a cobrar),
    "customer_name": "${finalName}",
    "addr": "${finalAddr}",
    "lat": ${finalLat || 'null'},
    "lon": ${finalLon || 'null'},
    "notes": "Alguna nota si aplica o vacío",
    "scheduled_at": "${scheduled_at}"
  }
}`;

            // 8. Llamar a Cohere
            const aiResponse = await cohereService.chat(systemPrompt, history);

            // 9. Guardar Respuesta en Memoria
            await storageService.saveMessage(phone, 'assistant', aiResponse.reply);

            // 10. Procesar Pedido si está listo
            if (aiResponse.is_ready) {
                await externalService.registerOrder({
                    phone: phone,
                    customer_name: aiResponse.order.customer_name,
                    address: aiResponse.order.addr,
                    latitude: aiResponse.order.lat,
                    longitude: aiResponse.order.lon,
                    product_id: aiResponse.order.p_id || 1,
                    quantity: aiResponse.order.qty,
                    total_amount: aiResponse.order.total_amount,
                    discount: aiResponse.order.discount,
                    notes: aiResponse.order.notes,
                    scheduled_at: aiResponse.order.scheduled_at
                });
                
                // Limpiar memoria después de un pedido exitoso
                await storageService.clearHistory(phone);
            }

            // 11. Enviar WhatsApp Final usando el TOKEN DINÁMICO de la cuenta
            await externalService.sendWhatsAppMessage(recipient, aiResponse.reply, whatsappToken);

            return { success: true };

        } catch (error) {
            console.error('Error in FlowService:', error);
            throw error;
        }
    }

    normalizeInput(data) {
        const body = data.data || {};
        const msg = body.message || {};
        
        let type = "text";
        let lat = null;
        let lon = null;
        let text = msg.conversation || (msg.extendedTextMessage ? msg.extendedTextMessage.text : "");

        if (msg.locationMessage) {
            type = "location";
            lat = msg.locationMessage.degreesLatitude;
            lon = msg.locationMessage.degreesLongitude;
            text = "[UBICACIÓN GPS ENVIADA POR EL CLIENTE]";
        }

        const rawFrom = body.senderJid ? body.senderJid.split('@')[0] : (body.from ? body.from.split('@')[0] : "");
        const digits = rawFrom.replace(/\D/g, '');
        const fullRecipient = digits.length === 9 ? '51' + digits : (digits.startsWith('51') ? digits : '51' + digits);
        const nineDigits = digits.slice(-9);

        return {
            type,
            lat,
            lon,
            text,
            recipient: fullRecipient,
            phone: nineDigits,
            pushName: body.pushName || "Cliente"
        };
    }
}

module.exports = new FlowService();
