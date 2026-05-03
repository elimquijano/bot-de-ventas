const axios = require('axios');
const config = require('../config/envs');

class ExternalService {
    constructor() {
        this.adminApi = axios.create({
            baseURL: config.ADMIN_API_BASE_URL,
            headers: { 'Authorization': `Bearer ${config.ADMIN_API_TOKEN}` }
        });
        
        // Base URL de la API de WhatsApp (puerto 3001)
        this.whatsappApiBaseUrl = config.WHATSAPP_API_BASE_URL;
    }

    async getProducts() {
        try {
            const res = await this.adminApi.get('/products?per_page=-1');
            return res.data.data || [];
        } catch (error) {
            console.error('Error fetching products:', error.message);
            return [];
        }
    }

    async getClients() {
        try {
            const res = await this.adminApi.get('/clients?per_page=-1');
            return res.data.data || [];
        } catch (error) {
            console.error('Error fetching clients:', error.message);
            return [];
        }
    }

    async getPendingSales() {
        try {
            const res = await this.adminApi.get('/sales?status=pending&is_delivery=1&per_page=-1');
            return res.data.data || [];
        } catch (error) {
            console.error('Error fetching pending sales:', error.message);
            return [];
        }
    }

    async cancelSale(saleId) {
        try {
            const res = await this.adminApi.post(`/sales/${saleId}/cancel`);
            return res.data;
        } catch (error) {
            console.error(`Error cancelling sale ${saleId}:`, error.response?.data || error.message);
            return { error: true };
        }
    }

    async getReverseGeocoding(lat, lon) {
        try {
            const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${config.MAPBOX_ACCESS_TOKEN}&limit=1`;
            const res = await axios.get(url);
            return res.data.features[0]?.place_name || "No enviada";
        } catch (error) {
            console.error('Error in geocoding:', error.message);
            return "No enviada";
        }
    }

    async registerOrder(orderData) {
        try {
            // Recibe rider_id dinámicamente o usa uno por defecto
            const res = await this.adminApi.post('/sales/quick-order', {
                ...orderData,
                rider_id: orderData.rider_id || 2
            });
            return res.data;
        } catch (error) {
            console.error('Error registering order:', error.response?.data || error.message);
            return { error: true };
        }
    }

    async getOpenCashRegisters() {
        try {
            const res = await this.adminApi.get('/cash-registers?status=open');
            return res.data.data || [];
        } catch (error) {
            console.error('Error fetching cash registers:', error.message);
            return [];
        }
    }

    async sendWhatsAppMessage(recipient, body, token) {

        try {
            // Cada llamada usa su propio token dinámico
            const res = await axios.post(`${this.whatsappApiBaseUrl}/messages/text`, 
                { recipient, body }, 
                { headers: { 'Authorization': `Bearer ${token}` } }
            );
            return res.data;
        } catch (error) {
            console.error('Error sending WhatsApp message:', error.response?.data || error.message);
            return { error: true };
        }
    }

    async downloadMedia(mediaKey, token) {
        try {
            const res = await axios.get(`${this.whatsappApiBaseUrl}/messages/download/${mediaKey}`, {
                headers: { 'Authorization': `Bearer ${token}` },
                responseType: 'arraybuffer'
            });
            return Buffer.from(res.data).toString('base64');
        } catch (error) {
            console.error('Error downloading media:', error.message);
            return null;
        }
    }
}

module.exports = new ExternalService();
