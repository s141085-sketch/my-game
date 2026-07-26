const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};
function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
    console.log('لاعب جديد:', socket.id);

    socket.on('createRoom', ({ playerName, gameDuration }) => {
        const roomCode = generateRoomCode();
        const player = { id: socket.id, name: playerName, isHost: true, correct: 0, wrong: 0, avgTime: 0, score: 0 };
        rooms[roomCode] = {
            players: [player],
            gameDuration: gameDuration,
            isPlaying: false,
            timer: null
        };
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode });
        io.to(roomCode).emit('updatePlayers', rooms[roomCode].players);
    });

    socket.on('joinRoom', ({ playerName, roomCode }) => {
        const room = rooms[roomCode];
        if (!room) { socket.emit('errorMessage', 'الغرفة غير موجودة!'); return; }
        if (room.isPlaying) { socket.emit('errorMessage', 'اللعبة بدأت!'); return; }
        if (room.players.find(p => p.name === playerName)) { socket.emit('errorMessage', 'الاسم مكرر!'); return; }
        const player = { id: socket.id, name: playerName, isHost: false, correct: 0, wrong: 0, avgTime: 0, score: 0 };
        room.players.push(player);
        socket.join(roomCode);
        socket.emit('joinedSuccess', { roomCode });
        io.to(roomCode).emit('updatePlayers', room.players);
    });

    socket.on('startGame', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room || room.players.length < 2) { io.to(roomCode).emit('errorMessage', 'يلزم لاعبين على الأقل!'); return; }
        room.isPlaying = true;
        room.players.forEach(p => { p.correct = 0; p.wrong = 0; p.avgTime = 0; p.score = 0; });
        io.to(roomCode).emit('gameStarting', { duration: room.gameDuration });
        
        let timeLeft = room.gameDuration;
        room.timer = setInterval(() => {
            timeLeft--;
            io.to(roomCode).emit('timerTick', { timeLeft });
            if (timeLeft <= 0) {
                clearInterval(room.timer);
                room.isPlaying = false;
                io.to(roomCode).emit('requestResults');
            }
        }, 1000);
    });

    socket.on('sendResults', ({ roomCode, correct, wrong, avgTime }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        player.correct = correct;
        player.wrong = wrong;
        player.avgTime = avgTime;
        const speedBonus = (avgTime > 0 && avgTime < 2) ? 20 : (avgTime < 3 ? 10 : 0);
        player.score = Math.max(0, (correct * 10) - (wrong * 5) + speedBonus);

        const allSent = room.players.every(p => p.correct !== undefined);
        if (allSent) {
            const sorted = [...room.players].sort((a, b) => b.score - a.score);
            io.to(roomCode).emit('gameEnded', { ranking: sorted, winnerName: sorted[0].name });
        }
    });

    socket.on('disconnect', () => {
        for (const [roomCode, room] of Object.entries(rooms)) {
            const idx = room.players.findIndex(p => p.id === socket.id);
            if (idx !== -1) {
                room.players.splice(idx, 1);
                io.to(roomCode).emit('updatePlayers', room.players);
                if (room.players.length === 0) delete rooms[roomCode];
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ شغال على البورت ${PORT}`));