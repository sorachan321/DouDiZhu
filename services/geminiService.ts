import { GoogleGenAI } from "@google/genai";
import { Card, GameState, Player } from '../types';

let aiInstance: GoogleGenAI | null = null;

// Helper to initialize AI (checks for key)
const getAI = () => {
  if (aiInstance) return aiInstance;
  if (!process.env.API_KEY) return null;
  aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return aiInstance;
};

export const getGameAdvice = async (
  myHand: Card[],
  gameState: GameState,
  myPlayerId: string
): Promise<string> => {
  const ai = getAI();
  if (!ai) return "请配置 Gemini API Key 以获取 AI 建议。";

  // Simplify data for the prompt to save tokens
  const handStr = myHand.map(c => `${c.suit}${c.label}`).join(', ');
  
  const landlord = gameState.players.find(p => p.id === gameState.landlordId);
  const me = gameState.players.find(p => p.id === myPlayerId);
  const isLandlord = me?.role === 'LANDLORD';
  
  const lastCards = gameState.lastPlayedCards.map(c => `${c.suit}${c.label}`).join(', ');
  const lastPlayer = gameState.lastPlayerId;
  const isMyTurnToLead = !lastPlayer || lastPlayer === myPlayerId;

  const prompt = `
    我正在玩斗地主。
    我的手牌: [${handStr}]
    我的身份: ${isLandlord ? '地主' : '农民'}
    当前底分: ${gameState.baseBid}
    当前倍数: ${gameState.multiplier}
    
    ${isMyTurnToLead 
      ? '现在轮到我出牌（我有出牌权）。' 
      : `上家打出了: [${lastCards}]。`}
    
    请用简短的一句话给我出牌建议。如果是跟牌，告诉我出什么。如果我应该过（Pass），告诉我"不要出"。
    不要解释太多规则，直接给战术建议。
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });
    return response.text || "AI 正在思考...";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "AI 服务暂时不可用。";
  }
};
