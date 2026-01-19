const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');


mongoose.connect('mongodb://localhost:27017/chatdb')
  .then(() => {
    console.log('MongoDB connected');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });

const chatSchema = new mongoose.Schema({
    messages: [
        {
            id: String,
            message: String,
            timestamp: { type: Date, default: Date.now }
        }
    ]
});

const Chat = mongoose.model('Chat', chatSchema);

const app = express();
const PORT = 5999;

app.use(express.json());

app.use(cors({
    origin: 'http://localhost:5173'
}));

app.use((req, res, next) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; connect-src 'self' http://localhost:5999");
    next();
});

app.get('/', (req, res) => {
    res.send("Server started");
});

app.get('/messages', async (req, res) => {
    try {
        let chat = await Chat.findOne();
        if (!chat) {
            chat = new Chat({ messages: [] });
            await chat.save();
        }
        res.json(chat.messages);
    } catch (err) {
        res.status(500).json({ error: 'Error fetching messages' });
    }
});

app.post('/addMessage', async (req, res) => {
    const { id, message } = req.body;
    try {
        let chat = await Chat.findOne();
        if (!chat) {
            chat = new Chat({ messages: [] });
        }
        chat.messages.push({ id, message });
        await chat.save();

        console.log('Обновлённый массив сообщений:', chat.messages);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error saving message' });
    }
});

app.post('/clearChat', async (req, res) => {
    try {
        let chat = await Chat.findOne();
        if (!chat) {
            chat = new Chat({ messages: [] });
        } else {
            chat.messages = [];
        }
        await chat.save();
        console.log('Чат очищен через /clearChat');
        res.json({ success: true, message: 'Chat has been cleared' });
    } catch (err) {
        res.status(500).json({ error: 'Error clearing chat' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});