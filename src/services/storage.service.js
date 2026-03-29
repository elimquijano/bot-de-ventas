const fs = require('fs-extra');
const path = require('path');
const config = require('../config/envs');

class StorageService {
    constructor() {
        this.basePath = path.resolve(config.DB_PATH);
        fs.ensureDirSync(this.basePath);
    }

    getChatFilePath(phone) {
        return path.join(this.basePath, `${phone}.json`);
    }

    async getChatHistory(phone) {
        const filePath = this.getChatFilePath(phone);
        if (await fs.pathExists(filePath)) {
            return await fs.readJson(filePath);
        }
        return [];
    }

    async saveMessage(phone, role, content) {
        const history = await this.getChatHistory(phone);
        history.push({ role, content });

        // Mantener solo las últimas MAX_MEMORY interacciones
        const limitedHistory = history.slice(-config.MAX_MEMORY);
        
        const filePath = this.getChatFilePath(phone);
        await fs.writeJson(filePath, limitedHistory, { spaces: 2 });
        return limitedHistory;
    }

    async clearHistory(phone) {
        const filePath = this.getChatFilePath(phone);
        if (await fs.pathExists(filePath)) {
            await fs.writeJson(filePath, [], { spaces: 2 });
        }
    }
}

module.exports = new StorageService();
