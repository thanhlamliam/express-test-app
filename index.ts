import dotenv from 'dotenv';
import express, { Application, Request, Response } from 'express';
import mongoose, { Document, Types } from 'mongoose';
import { Server } from 'socket.io';
import http from "http";
import { Game, IBoard, IPlayer } from './models/game';
import path from 'path';

// For env file
dotenv.config();

// Server setup
const app: Application = express();
const port = process.env.PORT || 8000;
const mongoDBURL = process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/liam';
const server = http.createServer(app);
const io = new Server(server);
let winningLine: number[][] = [];

// Serve static files (React build)
app.use(express.static(path.join(__dirname, './public')));

// Utils
function generateUniqueGameId(): string {
  return Math.random().toString(36).substring(2, 9);
}

function initializeBoard(size: number = 24): IBoard[][] {
  return Array.from({ length: 24 }, () =>
    Array.from({ length: 24 }, () => ({
      value: '',
      isWin: false
    }))
  );
}

function getPlayerMark(playerId: string, players: Types.DocumentArray<IPlayer>): 'X' | 'O' {
  const player = players.find((p) => p.id === playerId);
  if (!player) {
    throw new Error(`Player with ID ${playerId} not found`);
  }
  return player.mark;
}

function getOpponentId(playerId: string, players: Types.DocumentArray<IPlayer>): string {
  const opponent = players.find((p) => p.id !== playerId);
  if (!opponent) {
    throw new Error(`Opponent not found for player ID ${playerId}`)
  }
  return opponent.id;
}

function checkWin(board: IBoard[][], row: number, col: number): boolean {
  let winningArr = [], preventArr = [];
  let currentUser = board[row][col].value;
  if (!currentUser) return false;

  const directions = [
    [
      [0, -1],
      [0, 1],
    ], // Ngang
    [
      [-1, 0],
      [1, 0],
    ], // Doc
    [
      [1, -1],
      [-1, 1],
    ], // Cheo phai
    [
      [-1, -1],
      [1, 1]
    ] // Cheo trai
  ]

  for (const direction of directions) {
    let count = 1;
    winningArr = [];
    preventArr = [];

    for (const [dx, dy] of direction) {
      winningArr.push([row, col]);
      let newRow = row + dx;
      let newCol = col + dy;

      while (
        newRow >= 0 &&
        newRow < board.length &&
        newCol >= 0 &&
        newCol < board.length
      ) {
        if (currentUser && board[newRow][newCol].value && currentUser !== board[newRow][newCol].value) {
          preventArr.push([newRow, newCol]);
          break;
        }

        if (currentUser === board[newRow][newCol].value) {
          winningArr.push([newRow, newCol]);
          count++;
          newRow = newRow + dx;
          newCol = newCol + dy;
        } else {
          break;
        }
      }
    }

    if ((count >= 5 && preventArr.length === 1) || (count === 4 && preventArr.length === 0)) {
      winningLine = winningArr;
      return true;
    }
  }

  winningArr = [];
  return false;
}

// Connect DB
mongoose.connect(mongoDBURL)
  .then(() => console.log("Connection Successful"))
  .catch((err) => console.error("Connection Error:", err));

// Init socket
io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Create
  socket.on('createGame', async () => {
    try {
      const gameId = generateUniqueGameId();
      const newGame = new Game({
        gameId,
        board: initializeBoard(),
        players: [{ id: socket.id, mark: 'X' }],
        currentTurn: socket.id,
      });
      await newGame.save();
      socket.join(gameId);
      socket.emit('gameCreated', gameId);
      io.to(gameId).emit('turnChanged', socket.id);
      console.log(`Game created: ${gameId} by ${socket.id}`);
    } catch (error) {
      console.error('Error creating game:', error);
      socket.emit('error', 'Failed to create game');
    }
  });

  // Join
  socket.on('joinGame', async (gameId: string) => {
    try {
      const game = await Game.findOne({ gameId });
      if (!game) {
        socket.emit('joinFailed', 'Game not found');
        return;
      }
      if (game.players.length >= 2) {
        socket.emit('joinFailed', 'Game is full');
        return;
      }

      game.players.push({ id: socket.id, mark: 'O' });
      await game.save();
      socket.join(gameId);
      socket.emit('gameJoined', gameId);
      io.to(gameId).emit('playersUpdated', game.players);
      io.to(gameId).emit('boardUpdated', game.board);
      console.log(`${socket.id} joined game: ${gameId}`);
    } catch (error) {
      console.error('Error joining game:', error);
      socket.emit('error', 'Failed to join game');
    }
  });

  // Move
  socket.on("makeMove", async (gameId: string, row: number, col: number) => {
    try {
      const game = await Game.findOne({ gameId });

      if (!game) {
        socket.emit("error", "Game not found");
        return;
      }

      if (game.currentTurn !== socket.id) {
        socket.emit("error", "Not your turn");
        return;
      }

      if (game.board[row][col].value !== '') {
        socket.emit('error', 'Cell already occupied');
        return;
      }

      const mark = getPlayerMark(socket.id, game.players);
      game.board[row][col].value = mark;

      if (checkWin(game.board, row, col)) {
        const newBoard = game.board.map((row, rowIndex) => {
          return row.map((cell, colIndex) => {
            return {
              ...cell,
              isWin: winningLine.some((e) => e[0] === rowIndex && e[1] === colIndex),
            }
          })
        })
        game.board = newBoard;
        io.to(gameId).emit('boardUpdated', game.board);
        io.to(gameId).emit('gameOver', { winner: socket.id, board: game.board });
        console.log(`Game ${gameId} won by ${socket.id}`);
      } else {
        game.currentTurn = getOpponentId(socket.id, game.players);
        io.to(gameId).emit('boardUpdated', game.board);
        io.to(gameId).emit('turnChanged', game.currentTurn);
      }

      await game.save();
    } catch (error) {
      console.error('Error making move:', error);
      socket.emit('error', 'Failed to process move');
    }
  });

  // Disconnection
  socket.on('disconnect', async () => {
    try {
      const games = await Game.find({ 'players.id': socket.id });
      for (const game of games) {
        game.players = game.players.filter((p) => p.id !== socket.id) as Types.DocumentArray<IPlayer>;
        if (game.players.length < 2) {
          io.to(game.gameId).emit('gameEnded', 'Opponent disconnected');
          await Game.deleteOne({ gameId: game.gameId }); // Clean up abandoned game
          console.log(`Game ${game.gameId} ended due to disconnection`);
        } else {
          await game.save();
          io.to(game.gameId).emit('playersUpdated', game.players);
        }
      }
      console.log(`Disconnected: ${socket.id}`);
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
})

app.get('/', (req: Request, res: Response) => {
  res.send('Welcome to Express & Typescript Server');
});

server.listen(port, () => {
  console.log(`Server is Fire at http://localhost:${port}`);
})
