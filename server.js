const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { Server } = require('socket.io');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0'; // Render'ın dış ağ erişimi için zorunludur
const port = process.env.PORT || 3000; // Render'ın atadığı portu dinamik alır

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

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

  // CORS izinleri eklenmiş Socket.io sunucusu
  const io = new Server(server, {
    cors: {
      origin: "*", // Vercel ve tüm dış isteklerin bağlanmasına izin verir
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log('Bir kullanıcı bağlandı:', socket.id);

    socket.on('join-room', (roomId) => {
      socket.join(roomId);
      socket.to(roomId).emit('user-connected', socket.id);

      socket.on('disconnect', () => {
        socket.to(roomId).emit('user-disconnected', socket.id);
      });
    });

    socket.on('update-seat', (data) => {
      socket.to(socket.roomId).emit('seat-update', { userId: socket.id, seat: data.seat });
    });

    socket.on('chat-message', (data) => {
      socket.broadcast.emit('chat-message', data);
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