require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const PORT = process.env.PORT || 5999;
const server = http.createServer(app);

app.use(express.json());
app.use(cors({ origin: "https://funchat-ochre.vercel.app" }));

const io = new Server(server, {
  cors: { origin: "https://funchat-ochre.vercel.app" },
});

const onlineUsers = new Map();

io.on("connection", (socket) => {
  console.log("🟢 User connected:", socket.id);

  socket.on("register", (userId) => {
    onlineUsers.set(userId, socket.id);
  });

  socket.on("disconnect", () => {
    for (let [userId, id] of onlineUsers.entries()) {
      if (id === socket.id) onlineUsers.delete(userId);
    }
    console.log("🔴 User disconnected:", socket.id);
  });
});

mongoose.set("strictQuery", true);
const MONGO_URI = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/chatdb";

async function startServer() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB connected");
    server.listen(PORT, () => console.log(`🚀 Server started on ${PORT}`));
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("🛑 MongoDB connection closed");
  process.exit(0);
});

const UserSchema = new mongoose.Schema({
  name: { type: String, index: true },
  password: String,
  avatar: String,
  friendCode: { type: String, unique: true },
  userChats: [
    { chatId: mongoose.Schema.Types.ObjectId, title: String },
  ],
  friends: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
});

const ChatSchema = new mongoose.Schema({
  title: String,
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  messages: [
    {
      sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      text: String,
      createdAt: { type: Date, default: Date.now },
    },
  ],
});

const User = mongoose.model("User", UserSchema);
const Chat = mongoose.model("Chat", ChatSchema);

app.get("/", (req, res) => res.send("Realtime server is running"));

app.get("/allUsers", async (req, res) => {
  const users = await User.find();
  res.json(users);
});

app.get("/data", async (req, res) => {
  try {
    const users = await User.find();

    const chats = await Chat.find().populate("participants", "name avatar");

    res.json({ users, chats });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

app.post("/getUserByName", async (req, res) => {
  const { nameToLogOn } = req.body;
  const user = await User.findOne({ name: new RegExp(`^${nameToLogOn}$`, "i") });
  res.json(user);
});

app.post("/getUserById", async (req, res) => {
  const { userId } = req.body;
  const user = await User.findById(userId);
  res.json(user);
});

app.post("/addUser", async (req, res) => {
  const { username, password } = req.body;

  try {
    const existingUser = await User.findOne({
      name: new RegExp(`^${username}$`, "i"),
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Имя пользователя уже занято",
      });
    }

    let friendCode;
    let isUnique = false;

    while (!isUnique) {
      friendCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      const existingCode = await User.findOne({ friendCode });
      if (!existingCode) {
        isUnique = true;
      }
    }

    const newUser = new User({
      name: username,
      password,
      avatar: username.charAt(0).toUpperCase(),
      friendCode,
      userChats: [],
      friends: [],
    });

    await newUser.save();

    res.json({ success: true, user: newUser });
  } catch (error) {
    console.error("Ошибка при создании пользователя:", error);
    res.status(500).json({
      success: false,
      message: "Ошибка сервера",
    });
  }
});

app.post("/addChat", async (req, res) => {
  const { userId, friendCode } = req.body;

  try {
    const user = await User.findById(userId);
    const friend = await User.findOne({ friendCode });

    if (!user || !friend) {
      return res.status(400).json({
        success: false,
        message: "Пользователь не найден",
      });
    }

    if (user._id.toString() === friend._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "Нельзя добавить самого себя",
      });
    }

    const existingChat = await Chat.findOne({
      participants: { $all: [user._id, friend._id] },
      $expr: { $eq: [{ $size: "$participants" }, 2] },
    });

    if (existingChat) {
      return res.json({
        success: true,
        chat: existingChat,
        userChatTitle: friend.name,
      });
    }

    const newChat = new Chat({
      title: `${user.name} и ${friend.name}`,
      participants: [user._id, friend._id],
      messages: [],
    });

    await newChat.save();

    user.userChats.push({
      chatId: newChat._id,
      title: friend.name,
    });

    friend.userChats.push({
      chatId: newChat._id,
      title: user.name,
    });

    user.friends.push(friend._id);
    friend.friends.push(user._id);

    await user.save();
    await friend.save();

    [user._id, friend._id].forEach((id) => {
      const socketId = onlineUsers.get(id.toString());

      if (socketId) {
        io.to(socketId).emit("newChat", {
          chat: newChat,
          title:
            id.toString() === user._id.toString()
              ? friend.name
              : user.name,
        });
      }
    });

    res.json({
      success: true,
      chat: newChat,
      userChatTitle: friend.name,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

app.post("/getChatById", async (req, res) => {
  const { chatId } = req.body;
  if (!chatId) return res.status(400).json({ success: false, message: "chatId не указан" });

  const chat = await Chat.findById(chatId).populate("participants", "name avatar");
  if (!chat) return res.status(404).json({ success: false, message: "Чат не найден" });

  res.json({
    chatId: chat._id,
    messages: chat.messages.map((m) => ({
      _id: m._id,
      sender: m.sender,
      text: m.text,
      createdAt: m.createdAt,
    })),
    users: chat.participants,
  });
});

app.post("/addMessage", async (req, res) => {
  const { userId, text, currentChatId } = req.body;

  try {
    const chat = await Chat.findById(currentChatId);
    if (!chat) return res.status(404).json({ success: false, message: "Чат не найден" });

    const message = { sender: userId, text };
    chat.messages.push(message);
    await chat.save();

    chat.participants.forEach((participantId) => {
      const socketId = onlineUsers.get(participantId.toString());
      if (socketId) {
        io.to(socketId).emit("newMessage", { ...message, chatId: currentChatId });
      }
    });

    res.json({ success: true, message });
  } catch (err) {
    console.error("Ошибка при добавлении сообщения:", err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
});

app.post("/deleteProfile", async (req, res) => {
  const { userId } = req.body;
  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false });

    const chats = await Chat.find({ participants: userId });
    const chatIds = chats.map((c) => c._id);

    await Chat.deleteMany({ _id: { $in: chatIds } });
    await User.updateMany({}, { $pull: { userChats: { chatId: { $in: chatIds } }, friends: userId } });
    await User.findByIdAndDelete(userId);

    user.friends.forEach((friendId) => {
      const socketId = onlineUsers.get(friendId.toString());
      if (socketId) io.to(socketId).emit("userDeleted", { deletedUserId: userId, chatIds });
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

startServer();

// const express = require("express");
// const fs = require("fs");
// const path = require("path");
// const cors = require("cors");
// const multer = require("multer");
// const http = require("http");
// const { Server } = require("socket.io");

// const app = express();
// const PORT = 5999;

// const server = http.createServer(app);

// const io = new Server(server, {
//   cors: {
//     origin: "http://localhost:5173",
//     methods: ["GET", "POST"]
//   },
//   transports: ["websocket", "polling"]
// });

// app.use(express.json());

// app.use(
//   cors({
//     origin: "http://localhost:5173"
//   })
// );

// app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// app.get("/", (req, res) => {
//   res.send("Realtime server running");
// });

// const dataFilePath = path.join(__dirname, "data.json");

// function readUserData() {
//   return JSON.parse(fs.readFileSync(dataFilePath));
// }

// function writeUserData(data) {
//   fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
// }

// io.on("connection", (socket) => {

//   socket.on("joinChat", (chatId) => {
//     socket.join("chat_" + chatId);
//   });

//   socket.on("disconnect", () => {
//   });

// });

// app.get("/allUsers", (req, res) => {
//   const userData = readUserData();
//   res.json(userData.users || []);
// });

// app.post("/getUserByName", (req, res) => {
//   const { nameToLogOn } = req.body;

//   const users = readUserData().users || [];

//   const user = users.find(
//     (u) => u.name.toLowerCase() === nameToLogOn.toLowerCase()
//   );

//   res.json(user);
// });

// app.post("/addUser", (req, res) => {
//   const { username, password } = req.body;

//   const data = readUserData();

//   const users = data.users || [];

//   let id;

//   do {
//     id = Math.floor(Math.random() * 10000);
//   } while (users.find((u) => u.id === id));

//   const friendCode = Math.random().toString(36).substring(2, 8).toUpperCase();

//   const newUser = {
//     name: username,
//     id,
//     password,
//     avatar: null,
//     friendCode,
//     userChats: [],
//     friends: [],
//   };

//   users.push(newUser);

//   data.users = users;

//   writeUserData(data);

//   io.emit("userAdded", newUser);

//   res.json({
//     success: true,
//     userId: id,
//     friendCode,
//   });
// });

// app.post("/getUserById", (req, res) => {
//   const { userId } = req.body;

//   const users = readUserData().users || [];

//   const user = users.find((u) => u.id === userId);

//   res.json(user);
// });

// const upload = multer({
//   storage: multer.diskStorage({
//     destination: (req, file, cb) => cb(null, "uploads"),
//     filename: (req, file, cb) => {
//       cb(null, "avatar-" + req.body.userId + path.extname(file.originalname));
//     },
//   }),
// });

// app.post("/uploadAvatar", upload.single("avatar"), (req, res) => {
//   const { userId } = req.body;

//   const data = readUserData();

//   const user = data.users.find((u) => u.id == userId);

//   user.avatar = "/uploads/" + req.file.filename;

//   writeUserData(data);

//   io.emit("avatarUpdated", {
//     userId: user.id,
//     avatar: user.avatar,
//   });

//   res.json({
//     success: true,
//     avatar: user.avatar,
//   });
// });

// app.post("/addChat", (req, res) => {
//   const { userId, friendCode } = req.body;

//   const data = readUserData();

//   const users = data.users;

//   const chats = data.chats || [];

//   const user = users.find((u) => u.id === userId);

//   const friend = users.find((u) => u.friendCode === friendCode);

//   let chatId;

//   do {
//     chatId = Math.floor(Math.random() * 10000);
//   } while (chats.find((c) => c.id === chatId));

//   const newChat = {
//     id: chatId,
//     title: `Чат ${user.name} и ${friend.name}`,
//     messages: [],
//   };

//   chats.push(newChat);

//   user.userChats.push({
//     id: chatId,
//     title: `Чат с ${friend.name}`,
//   });

//   friend.userChats.push({
//     id: chatId,
//     title: `Чат с ${user.name}`,
//   });

//   user.friends.push(friend.id);
//   friend.friends.push(user.id);

//   data.users = users;
//   data.chats = chats;

//   writeUserData(data);

//   io.emit("chatAdded", {
//     chat: newChat,
//     user1: user.id,
//     user2: friend.id,
//   });

//   res.json({
//     success: true,
//     chat: newChat,
//   });
// });

// app.post("/addMessage", (req, res) => {
//     const { userId, text, currentChatId } = req.body;

//     const data = readUserData();
//     const chat = data.chats.find((c) => c.id === currentChatId);

//     let id;
//     do {
//       id = Math.floor(Math.random() * 100000);
//     } while (chat.messages.find((m) => m.id === id));

//     const message = {
//       sender: userId,
//       text,
//       id,
//     };

//     chat.messages.push(message);
//     writeUserData(data);

//     io.emit("messageAdded", {
//       chatId: currentChatId,
//       message,
//     });

//     res.json({ success: true, message });
// });

// app.post("/getChatById", (req, res) => {
//   const { chatId } = req.body;

//   const data = readUserData();

//   const chat = data.chats.find((c) => c.id === chatId);

//   const users = data.users
//     .filter((u) => u.userChats.some((c) => c.id === chatId))
//     .map((u) => ({
//       id: u.id,
//       name: u.name,
//       avatar: u.avatar,
//     }));

//   res.json({
//     messages: chat.messages,
//     users,
//   });
// });

// app.post("/deleteProfile", (req, res) => {
//   const { userId } = req.body;

//   const data = readUserData();

//   data.users = data.users.filter((u) => u.id !== Number(userId));

//   writeUserData(data);

//   io.emit("userDeleted", userId);

//   res.json({
//     success: true,
//   });
// });

// server.listen(PORT, () => {
//   console.log("Server started 5999");
// });

// {
//     "users": [
//       {
//         "name": "Aleksey",
//         "id": 6666,
//         "password": "666999",
//         "avatar": "/uploads/avatar-undefined.jpeg",
//         "friendCode": "74KOQT",
//         "userChats": [
//           {
//             "title": "Чат с Person",
//             "id": 3122
//           }
//         ],
//         "friends": [
//           4966
//         ]
//       },
//       {
//         "name": "Person",
//         "id": 4966,
//         "password": "ghhjjddhj",
//         "avatar": "/uploads/avatar-undefined.png",
//         "friendCode": "7FW7B7",
//         "userChats": [
//           {
//             "title": "Чат с Aleksey",
//             "id": 3122
//           }
//         ],
//         "friends": [
//           9807
//         ]
//       }
//     ],
//     "chats": [
//       {
//         "title": "Чат Aleksey и Person",
//         "id": 3122,
//         "messages": []
//       }
//     ]
//   }
