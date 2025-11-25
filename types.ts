// Card Suits and Ranks
export enum Suit {
  Hearts = '♥',
  Diamonds = '♦',
  Clubs = '♣',
  Spades = '♠',
  None = '' // For Jokers
}

export enum Rank {
  Three = 3, Four, Five, Six, Seven,
  Eight, Nine, Ten, Jack, Queen, King, Ace, Two,
  SmallJoker = 16,
  BigJoker = 17
}

export interface Card {
  id: string;
  suit: Suit;
  rank: Rank;
  label: string;
  value: number;
}

export enum PlayerRole {
  Landlord = 'LANDLORD',
  Peasant = 'PEASANT'
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  role: PlayerRole;
  ready: boolean;
  beans: number;
  lastAction?: string; // "叫地主", "3分", "不出", etc.
  isBot: boolean;
}

export enum GamePhase {
  Lobby = 'LOBBY',
  Dealing = 'DEALING',
  Bidding = 'BIDDING',
  Playing = 'PLAYING',
  GameOver = 'GAMEOVER'
}

export interface GameConfig {
  enableLaizi: boolean;
  isDedicated: boolean; // Is the host a dedicated server/spectator?
}

export interface GameState {
  phase: GamePhase;
  players: Player[];
  deck: Card[];
  currentTurnIndex: number;
  landlordId: string | null;
  baseBid: number;
  multiplier: number;
  lastPlayedCards: Card[];
  lastPlayerId: string | null;
  kittyCards: Card[];
  winnerId: string | null;
  laiziRank: number | null; // The rank that acts as Laizi (e.g., 3)
  config: GameConfig;
}

export interface NetworkMessage {
  type: 'JOIN_REQUEST' | 'GAME_STATE_UPDATE' | 'ACTION_BID' | 'ACTION_PLAY' | 'ACTION_RESTART';
  name?: string; // For JOIN_REQUEST
  state?: GameState; // For UPDATE
  amount?: number; // For BID
  cards?: Card[]; // For PLAY
}