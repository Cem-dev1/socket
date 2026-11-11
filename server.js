const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Oda üyelerini takip et: roomId -> Set<socketId>
const roomMembers = new Map();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('İstek işlenirken hata oluştu:', err);
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
    console.log('Bir kullanıcı bağlandı:', socket.id);

    let currentRoom = null;

    socket.on('join-room', (roomId) => {
      // Eski odadan çık
      if (currentRoom && currentRoom !== roomId) {
        socket.leave(currentRoom);
        const oldMembers = roomMembers.get(currentRoom);
        if (oldMembers) {
          oldMembers.delete(socket.id);
          if (oldMembers.size === 0) roomMembers.delete(currentRoom);
        }
        socket.to(currentRoom).emit('user-disconnected', socket.id);
      }

      currentRoom = roomId;
      socket.join(roomId);

      if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
      const members = roomMembers.get(roomId);

      // ✅ Yeni gelen kişiye MEVCUT üyelerin listesini gönder
      const existingMembers = Array.from(members);
      socket.emit('existing-members', { members: existingMembers });

      // Mevcut üyelere yeni geleni bildir
      socket.to(roomId).emit('user-connected', socket.id);

      members.add(socket.id);
      console.log(`[Oda ${roomId}] ${socket.id} katıldı. Toplam: ${members.size}`);
    });

    socket.on('disconnect', () => {
      if (currentRoom) {
        const members = roomMembers.get(currentRoom);
        if (members) {
          members.delete(socket.id);
          if (members.size === 0) roomMembers.delete(currentRoom);
        }
        socket.to(currentRoom).emit('user-disconnected', socket.id);
      }
      console.log('Kullanıcı ayrıldı:', socket.id);
    });

    socket.on('update-seat', (data) => {
      if (currentRoom) {
        socket.to(currentRoom).emit('seat-update', { userId: socket.id, seat: data.seat });
      }
    });

    socket.on('chat-message', (data) => {
      if (currentRoom) {
        socket.to(currentRoom).emit('chat-message', data);
        // Kendine de gönder (UI'da zaten ekleniyor ama tutarlılık için)
      }
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
    console.log(`> Hazır! Sunucu çalışıyor: http://${hostname}:${port}`);
  });
}).catch((ex) => {
  console.error('Sunucu başlatılamadı:', ex.stack);
  process.exit(1);
});