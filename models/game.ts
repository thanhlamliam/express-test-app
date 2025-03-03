import mongoose, { Types } from "mongoose";
import { Schema } from "mongoose";

export interface IPlayer {
  id: string;
  mark: 'X' | 'O';
}

export interface IGame extends Document {
  gameId: string;
  board: string[][];
  players: Types.DocumentArray<IPlayer>;
  currentTurn: string;
}

// Define Player subdocument schema
const playerSchema = new Schema({
  id: { type: String, required: true },
  mark: { type: String, enum: ['X', 'O'], required: true },
}, { _id: false }); // Disable _id for subdocuments if not needed

const gameSchema = new Schema({
  gameId: { type: String, unique: true, required: true },
  board: {
    type: [[String]],
    default: function () {
      return Array(24).fill('').map(() => Array(24).fill(''));
    }
  },
  players: [playerSchema],
  currentTurn: String
});

export const Game = mongoose.model<IGame>('Game', gameSchema);
