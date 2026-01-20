const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5999;

app.use(express.json());

app.use(cors({
    origin: 'https://chat-nine-xi-35.vercel.app'
}));

app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; connect-src 'self' https://chat-nine-xi-35.vercel.app");
    next();
});

app.get('/', (req, res) => {
    res.send("Server started");
});

const dataFilePath = path.join(__dirname, 'data.json');

function readMessagesData() {
    const messagesData = fs.readFileSync(dataFilePath);
    return JSON.parse(messagesData);
}

function writeMessagesData(data) {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
}

app.get('/messages', async (req, res) => {
    const data = readMessagesData();
    res.json(data.messages);
});

app.post('/addMessage', async (req, res) => {
    const { message } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Missing id or message' });
    }

    const data = readMessagesData();

    data.messages.push({ message });

    writeMessagesData(data);

    res.json({ success: true });
});

app.post('/clearChat', async (req, res) => {
    const data = { messages: [] };
    writeMessagesData(data);
    console.log('Chat has been cleared!');
    res.json({ success: true, message: 'Chat has been cleared' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});