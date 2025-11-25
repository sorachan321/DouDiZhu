import { Rank, Suit, Card } from './types';

export const INITIAL_BEANS = 10000;

export const createDeck = (): Card[] => {
  const deck: Card[] = [];
  const suits = [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades];
  const ranks = [
    { r: Rank.Three, l: '3', v: 3 },
    { r: Rank.Four, l: '4', v: 4 },
    { r: Rank.Five, l: '5', v: 5 },
    { r: Rank.Six, l: '6', v: 6 },
    { r: Rank.Seven, l: '7', v: 7 },
    { r: Rank.Eight, l: '8', v: 8 },
    { r: Rank.Nine, l: '9', v: 9 },
    { r: Rank.Ten, l: '10', v: 10 },
    { r: Rank.Jack, l: 'J', v: 11 },
    { r: Rank.Queen, l: 'Q', v: 12 },
    { r: Rank.King, l: 'K', v: 13 },
    { r: Rank.Ace, l: 'A', v: 14 },
    { r: Rank.Two, l: '2', v: 15 },
  ];

  let idCounter = 0;

  ranks.forEach((rank) => {
    suits.forEach((suit) => {
      deck.push({
        id: `card-${idCounter++}`,
        suit: suit,
        rank: rank.r,
        label: rank.l,
        value: rank.v,
      });
    });
  });

  // Jokers
  deck.push({ id: `card-${idCounter++}`, suit: Suit.None, rank: Rank.SmallJoker, label: 'Joker', value: 16 });
  deck.push({ id: `card-${idCounter++}`, suit: Suit.None, rank: Rank.BigJoker, label: 'JOKER', value: 17 });

  return deck;
};

export const shuffleDeck = (deck: Card[]): Card[] => {
  const newDeck = [...deck];
  for (let i = newDeck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newDeck[i], newDeck[j]] = [newDeck[j], newDeck[i]];
  }
  return newDeck;
};

export const sortHand = (hand: Card[]): Card[] => {
  return [...hand].sort((a, b) => b.value - a.value); // Descending order
};

// Simple formatting for display
export const getSuitColor = (suit: Suit) => {
  if (suit === Suit.Hearts || suit === Suit.Diamonds) return 'text-red-600';
  if (suit === Suit.None) return 'text-purple-600'; // Jokers
  return 'text-gray-900';
};
