import mongoose, { Types } from "mongoose";
import { Schema } from "mongoose";

export interface IPlayer {
  id: string;
  mark: 'X' | 'O';
}

export interface IBoard {
  value: string;
  isWin: boolean;
}

export interface IGame extends Document {
  gameId: string;
  board: IBoard[][];
  players: Types.DocumentArray<IPlayer>;
  currentTurn: string;
}

// Define Player subdocument schema
const playerSchema = new Schema({
  id: { type: String, required: true },
  mark: { type: String, enum: ['X', 'O'], required: true },
}, { _id: false }); // Disable _id for subdocuments if not needed

const boardSchema = new Schema({
  value: { type: String },
  isWin: { type: Boolean }
}, { _id: false })

const gameSchema = new Schema({
  gameId: { type: String, unique: true, required: true },
  board: {
    type: [[boardSchema]],
    default: function () {
      return Array.from({ length: 24 }, () =>
        Array.from({ length: 24 }, () => ({
          value: '',
          isWin: false
        }))
      )
    }
  },
  players: [playerSchema],
  currentTurn: String
});

export const Game = mongoose.model<IGame>('Game', gameSchema);
