const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// roomId -> Map<socketId, { seat }>
const roomMembers = new Map();

// ✅ Tüm odaların kullanıcı listesini yayınla
const broadcastRoomList = (io) => {
  const list = {};
  for (const [roomId, members] of roomMembers.entries()) {
    if (members.size > 0) {
      list[roomId] = Array.from(members.keys());
    }
  }
  io.emit('room-list', list);
};

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('İstek hatası:', err);
      res.statusCode = 500;
      res.end('internal server error');
    }
  });

  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'], credentials: true },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    console.log('✅ Bağlandı:', socket.id);

    let currentRoom = null;

    // ✅ Bağlanınca mevcut oda listesini gönder
    const initialList = {};
    for (const [roomId, members] of roomMembers.entries()) {
      if (members.size > 0) initialList[roomId] = Array.from(members.keys());
    }
    socket.emit('room-list', initialList);

    socket.on('join-room', (roomId) => {
      console.log(`[join-room] ${socket.id} → ${roomId}`);

      if (currentRoom === roomId) {
        socket.emit('existing-members', {
          members: Array.from(roomMembers.get(roomId)?.keys() || []).filter(id => id !== socket.id),
        });
        return;
      }

      if (currentRoom) {
        socket.leave(currentRoom);
        const oldMembers = roomMembers.get(currentRoom);
        if (oldMembers) {
          oldMembers.delete(socket.id);
          if (oldMembers.size === 0) roomMembers.delete(currentRoom);
        }
        socket.to(currentRoom).emit('user-disconnected', socket.id);
        currentRoom = null;
      }

      currentRoom = roomId;
      socket.join(roomId);

      if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Map());
      const members = roomMembers.get(roomId);

      const existingMembers = Array.from(members.keys()).filter(id => id !== socket.id);
      console.log(`[join-room] ${socket.id} için mevcut:`, existingMembers);
      socket.emit('existing-members', { members: existingMembers });

      socket.to(roomId).emit('user-connected', socket.id);

      members.set(socket.id, { seat: 0 });

      // ✅ Tüm client'lara güncel oda listesini gönder
      broadcastRoomList(io);
    });

    socket.on('leave-room', () => {
      if (currentRoom) {
        const room = currentRoom;
        socket.leave(room);
        const members = roomMembers.get(room);
        if (members) {
          members.delete(socket.id);
          if (members.size === 0) roomMembers.delete(room);
        }
        socket.to(room).emit('user-disconnected', socket.id);
        currentRoom = null;
        broadcastRoomList(io);
      }
    });

    socket.on('disconnect', () => {
      if (currentRoom) {
        const room = currentRoom;
        const members = roomMembers.get(room);
        if (members) {
          members.delete(socket.id);
          if (members.size === 0) roomMembers.delete(room);
        }
        socket.to(room).emit('user-disconnected', socket.id);
        broadcastRoomList(io);
      }
      console.log('❌ Ayrıldı:', socket.id);
    });

    socket.on('update-seat', (data) => {
      if (currentRoom) {
        const members = roomMembers.get(currentRoom);
        if (members && members.has(socket.id)) {
          members.get(socket.id).seat = data.seat;
        }
        socket.to(currentRoom).emit('seat-update', { userId: socket.id, seat: data.seat });
      }
    });

    socket.on('chat-message', (data) => {
      if (currentRoom) socket.to(currentRoom).emit('chat-message', data);
    });

    socket.on('offer', (data) => {
      socket.to(data.target).emit('offer', { signal: data.signal, caller: socket.id });
    });

    socket.on('answer', (data) => {
      socket.to(data.target).emit('answer', { signal: data.signal, id: socket.id });
    });

    socket.on('ice-candidate', (data) => {
      socket.to(data.target).emit('ice-candidate', { candidate: data.candidate, id: socket.id });
    });
  });

  server.listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Hazır: http://${hostname}:${port}`);
  });
}).catch((ex) => {
  console.error('Sunucu başlatılamadı:', ex.stack);
  process.exit(1);
});