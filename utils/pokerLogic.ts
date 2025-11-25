import { Card } from '../types';

// NOTE: A full Dou Dizhu validator is complex. This is a simplified version 
// that detects Single, Pair, Triple, Bomb, Rocket.
// It assumes the cards are already sorted by rank (value).

export const isValidPlay = (cards: Card[], lastCards: Card[], laiziRank: number | null): boolean => {
  if (cards.length === 0) return false;

  // --- Laizi Processing ---
  // If we have a Laizi, we treat it as a Wild Card.
  // Strategy: If mixed with other cards, treat Laizi as the rank of the *other* cards to form pairs/triples/bombs.
  // Note: This logic assumes simple substitutions. 

  let effectiveCards = [...cards];
  const laizis = laiziRank !== null ? cards.filter(c => c.rank === laiziRank) : [];
  const normals = laiziRank !== null ? cards.filter(c => c.rank !== laiziRank) : [...cards];

  // Logic: If we have Laizis and Normals, try to make the Laizis match the Normals
  if (laizis.length > 0 && normals.length > 0) {
      const targetVal = normals[0].value;
      // Only support changing Laizi if all normals are the same rank (e.g. 3, 3, Laizi -> 3, 3, 3)
      if (normals.every(c => c.value === targetVal)) {
          // Temporarily morph laizis to targetVal for validation
          effectiveCards = cards.map(c => {
              if (c.rank === laiziRank) return { ...c, value: targetVal }; 
              return c;
          });
      }
      // If normals are not uniform (e.g. straight), current simple logic won't auto-fill gaps.
      // To keep it simple, we only support Pair/Triplet/Bomb completion with Laizi for now.
  } else if (laizis.length > 0 && normals.length === 0) {
      // Only Laizis played? They act as their original value (e.g. Pair of Laizis)
      // No change needed to effectiveCards
  }

  // --- Standard Validation on Effective Cards ---
  const isUniform = effectiveCards.every(c => c.value === effectiveCards[0].value);
  const isRocket = cards.length === 2 && cards[0].value >= 16 && cards[1].value >= 16; // Rockets can't use Laizi usually
  
  if (!lastCards || lastCards.length === 0) {
    // Leading the trick
    if (isRocket) return true;
    if (isUniform) return true; 
    // TODO: Add straight validation here if needed
    return false;
  }

  // Comparing against last hand
  const lastIsRocket = lastCards.length === 2 && lastCards[0].value >= 16 && lastCards[1].value >= 16;
  const lastIsBomb = lastCards.length === 4 && lastCards.every(c => c.value === lastCards[0].value);
  
  // For comparison, we also need to know if the current hand IS a bomb (Soft Bomb or Hard Bomb)
  // Soft Bomb: Uses Laizi. Hard Bomb: No Laizi.
  // In many rules, Hard Bomb > Soft Bomb, but here we treat them equal for simplicity.
  const isBomb = effectiveCards.length === 4 && isUniform;

  // 1. Rocket beats everything
  if (isRocket) return true;
  if (lastIsRocket) return false;

  // 2. Bomb beats everything except Rocket and bigger Bomb
  if (isBomb) {
    if (!lastIsBomb) return true; // Beats non-bomb
    return effectiveCards[0].value > lastCards[0].value; // Beats smaller bomb
  }
  if (lastIsBomb) return false; // Can't beat bomb without bomb/rocket

  // 3. Normal comparison (Must match type and count)
  if (cards.length !== lastCards.length) return false;
  
  // Compare the effective value
  if (isUniform && effectiveCards[0].value > lastCards[0].value) return true;

  return false;
};

// --- Simple Bot Logic ---

// Helper: Group hand by value
const groupCards = (hand: Card[]) => {
  const groups: Record<number, Card[]> = {};
  hand.forEach(c => {
    if (!groups[c.value]) groups[c.value] = [];
    groups[c.value].push(c);
  });
  return groups;
};

export const getBotMove = (hand: Card[], lastPlayed: Card[], laiziRank: number | null): Card[] => {
  // NOTE: Simple Bot ignores Laizi superpower and just plays it as a normal card to avoid complexity.
  
  // 1. If we are leading (no last played cards), play the smallest single
  if (!lastPlayed || lastPlayed.length === 0) {
    // Strategy: Play smallest single, or smallest pair if no singles
    const sorted = [...hand].sort((a, b) => a.value - b.value);
    return [sorted[0]]; // Play smallest card
  }

  // 2. Analyze last played
  const groups = groupCards(hand);
  const lastVal = lastPlayed[0].value;
  const lastLen = lastPlayed.length;
  
  const lastIsRocket = lastPlayed.length === 2 && lastPlayed[0].value >= 16 && lastPlayed[1].value >= 16;
  const lastIsBomb = lastPlayed.length === 4 && lastPlayed.every(c => c.value === lastPlayed[0].value);

  if (lastIsRocket) return []; // Can't beat rocket

  // 3. Try to beat strictly (Same Type, Higher Value)
  // Check if strict type match is possible (e.g. Single vs Single, Pair vs Pair)
  // We only support uniform types (1, 2, 3, 4) in this simple bot
  const isUniformLast = lastPlayed.every(c => c.value === lastVal);
  
  if (isUniformLast && !lastIsBomb) {
      // Find a group of same length with higher value
      // Iterate keys (values)
      const possibleValues = Object.keys(groups).map(Number).sort((a, b) => a - b);
      for (const val of possibleValues) {
          if (val > lastVal && groups[val].length >= lastLen) {
              // Found a beat! Take the cards
              return groups[val].slice(0, lastLen);
          }
      }
  }

  // 4. Try to Bomb (if last wasn't a bigger bomb)
  const possibleValues = Object.keys(groups).map(Number).sort((a, b) => a - b);
  for (const val of possibleValues) {
      if (groups[val].length === 4) {
          if (!lastIsBomb) return groups[val]; // Any bomb beats non-bomb
          if (val > lastVal) return groups[val]; // Bigger bomb beats smaller bomb
      }
  }

  // 5. Try Rocket
  const sj = hand.find(c => c.value === 16);
  const bj = hand.find(c => c.value === 17);
  if (sj && bj) {
      return [sj, bj];
  }

  // Pass
  return [];
};

export const getBotBid = (hand: Card[]): number => {
    // Simple logic: count high cards (2, Jokers) and bombs
    let score = 0;
    const groups = groupCards(hand);
    
    hand.forEach(c => {
        if (c.value >= 15) score += 2; // 2 or Jokers
        if (c.value >= 13 && c.value < 15) score += 1; // K, A
    });
    
    // Bonus for bombs
    Object.values(groups).forEach(g => {
        if (g.length === 4) score += 3;
    });

    if (score > 6) return 3;
    if (score > 4) return 2;
    if (score > 2) return 1;
    return 0;
};