import React, { useState, useEffect, useRef } from 'react';
import { createDeck, shuffleDeck, sortHand, INITIAL_BEANS } from './constants';
import { GameState, GamePhase, Player, PlayerRole, NetworkMessage, Card, Rank } from './types';
import CardComponent from './components/CardComponent';
import { isValidPlay, getBotMove, getBotBid } from './utils/pokerLogic';
import { getGameAdvice } from './services/geminiService';

declare global {
  interface Window {
    Peer: any;
  }
}

// UI Components
const GameButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'success' }> = ({ children, variant = 'primary', className, ...props }) => {
  const variants = {
    primary: 'from-blue-400 to-blue-600 border-blue-800 text-white',
    secondary: 'from-gray-100 to-gray-300 border-gray-400 text-gray-800',
    danger: 'from-red-400 to-red-600 border-red-800 text-white',
    success: 'from-green-400 to-green-600 border-green-800 text-white',
  };

  return (
    <button
      className={`
        bg-gradient-to-b ${variants[variant]}
        font-bold py-2 px-6 rounded-xl shadow-lg border-b-4 
        active:border-b-0 active:translate-y-1 active:shadow-inner
        transition-all duration-100 uppercase tracking-wider text-sm md:text-base
        disabled:opacity-50 disabled:cursor-not-allowed
        ${className || ''}
      `}
      {...props}
    >
      {children}
    </button>
  );
};

const App: React.FC = () => {
  // Networking State
  const [peerId, setPeerId] = useState<string>('');
  const [targetPeerId, setTargetPeerId] = useState<string>('');
  const [connStatus, setConnStatus] = useState<string>('初始化...');
  const [isHost, setIsHost] = useState<boolean>(false);
  const [playerName, setPlayerName] = useState<string>(`玩家${Math.floor(Math.random() * 999)}`);
  
  // Lobby Settings
  const [isDedicated, setIsDedicated] = useState<boolean>(false);
  const [enableLaizi, setEnableLaizi] = useState<boolean>(false);

  // Game State
  const [gameState, setGameState] = useState<GameState>({
    phase: GamePhase.Lobby,
    players: [],
    deck: [],
    currentTurnIndex: 0,
    landlordId: null,
    baseBid: 0,
    multiplier: 1,
    lastPlayedCards: [],
    lastPlayerId: null,
    kittyCards: [],
    winnerId: null,
    laiziRank: null,
    config: { enableLaizi: false, isDedicated: false }
  });

  // Local UI State
  const [selectedCards, setSelectedCards] = useState<string[]>([]); // Card IDs
  const [aiAdvice, setAiAdvice] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState<boolean>(false);
  
  // Refs for PeerJS
  const peerRef = useRef<any>(null);
  const connectionsRef = useRef<any[]>([]);
  
  // Ref for Swipe Logic
  const swipeRef = useRef<{
    active: boolean;
    mode: boolean; // true = select, false = deselect
    processed: Set<string>;
    startX: number;
    startY: number;
  }>({ active: false, mode: true, processed: new Set(), startX: 0, startY: 0 });

  // 1. Initialize Peer
  useEffect(() => {
    const initPeer = async () => {
      // Small delay to ensure script load
      await new Promise(r => setTimeout(r, 500));
      if (!window.Peer) {
        setConnStatus('错误: PeerJS 未加载');
        return;
      }

      const peer = new window.Peer(null, { debug: 1 });
      
      peer.on('open', (id: string) => {
        setPeerId(id);
        peerRef.current = peer;
        setConnStatus('就绪');
      });

      peer.on('connection', (conn: any) => {
        conn.on('data', (data: NetworkMessage) => handleData(data, conn.peer));
        conn.on('open', () => {
            connectionsRef.current.push(conn);
        });
      });
      
      peer.on('error', (err: any) => {
        console.error(err);
        setConnStatus(`错误: ${err.type}`);
      });
    };
    initPeer();
  }, []);

  // 2. Broadcast State (Host Only)
  const broadcastState = (newState: GameState) => {
    setGameState(newState);
    connectionsRef.current.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'GAME_STATE_UPDATE', state: newState });
      }
    });
  };

  // 3. Handle Incoming Data
  const handleData = (data: NetworkMessage, fromPeerId: string) => {
    // If I am Host
    if (isHost) {
      if (data.type === 'JOIN_REQUEST') {
        const currentPlayers = gameState.players;
        if (currentPlayers.length >= 3) return; // Room full

        const newPlayer: Player = {
          id: fromPeerId,
          name: data.name || 'Unknown',
          hand: [],
          role: PlayerRole.Peasant,
          ready: true,
          beans: INITIAL_BEANS,
          isBot: false
        };

        const newPlayers = [...currentPlayers, newPlayer];
        const newState = { ...gameState, players: newPlayers };
        broadcastState(newState);
      } else if (data.type === 'ACTION_BID') {
        processBid(fromPeerId, data.amount!);
      } else if (data.type === 'ACTION_PLAY') {
        processPlay(fromPeerId, data.cards!);
      } else if (data.type === 'ACTION_RESTART') {
        startNewGame(gameState.players);
      }
    } 
    // If I am Client
    else {
      if (data.type === 'GAME_STATE_UPDATE' && data.state) {
        setGameState(data.state);
        // Reset local selection when turn changes or phase changes
        setSelectedCards([]); 
        setAiAdvice('');
      }
    }
  };

  // --- Host Logic ---

  const createRoom = (dedicated: boolean) => {
    setIsHost(true);
    setIsDedicated(dedicated);
    setConnStatus('等待玩家加入...');
    
    // If NOT dedicated, Host is Player 1
    const initialPlayers = dedicated ? [] : [{
      id: peerId,
      name: playerName + " (房主)",
      hand: [],
      role: PlayerRole.Peasant,
      ready: true,
      beans: INITIAL_BEANS,
      isBot: false
    }];

    setGameState(prev => ({
      ...prev,
      players: initialPlayers,
      config: { enableLaizi, isDedicated: dedicated }
    }));
  };

  const addBot = () => {
    if (gameState.players.length >= 3) return;
    const botId = `BOT-${Date.now()}`;
    const newPlayer: Player = {
      id: botId,
      name: `电脑 ${gameState.players.length + 1}`,
      hand: [],
      role: PlayerRole.Peasant,
      ready: true,
      beans: INITIAL_BEANS,
      isBot: true
    };
    broadcastState({
      ...gameState,
      players: [...gameState.players, newPlayer]
    });
  };

  const joinRoom = () => {
    const target = prompt("请输入房主ID:");
    if (!target) return;
    setTargetPeerId(target);
    const conn = peerRef.current.connect(target);
    conn.on('open', () => {
      setConnStatus('已连接房主');
      conn.send({ type: 'JOIN_REQUEST', name: playerName });
    });
    conn.on('data', (data: NetworkMessage) => handleData(data, target));
    // Keep reference to send actions
    connectionsRef.current = [conn];
  };

  const startNewGame = (players: Player[]) => {
    // 1. Shuffle
    const deck = shuffleDeck(createDeck());
    
    // 2. Deal (Simple dealing, animation handled by phase)
    // 17 cards each, 3 for kitty
    const p1Hand = sortHand(deck.slice(0, 17));
    const p2Hand = sortHand(deck.slice(17, 34));
    const p3Hand = sortHand(deck.slice(34, 51));
    const kitty = deck.slice(51);

    const updatedPlayers = players.map((p, i) => ({
      ...p,
      hand: i === 0 ? p1Hand : i === 1 ? p2Hand : p3Hand,
      role: PlayerRole.Peasant,
      lastAction: '',
      isBot: p.isBot
    }));

    broadcastState({
      ...gameState,
      phase: GamePhase.Dealing, // Trigger dealing animation logic if we want complex one, for now simpler
      deck: [], // Deck distributed
      players: updatedPlayers,
      kittyCards: kitty,
      landlordId: null,
      baseBid: 0,
      multiplier: 1,
      currentTurnIndex: Math.floor(Math.random() * 3),
      lastPlayedCards: [],
      lastPlayerId: null,
      winnerId: null,
      laiziRank: null
    });

    // Short delay to simulate dealing then move to bidding
    setTimeout(() => {
        broadcastState({
            ...gameState,
            phase: GamePhase.Bidding,
            players: updatedPlayers,
            kittyCards: kitty,
            currentTurnIndex: Math.floor(Math.random() * 3),
            baseBid: 0,
            multiplier: 1,
            lastPlayedCards: [],
            lastPlayerId: null,
            winnerId: null,
            laiziRank: null
        });
    }, 2000);
  };

  const processBid = (playerId: string, amount: number) => {
    const playerIdx = gameState.players.findIndex(p => p.id === playerId);
    if (playerIdx !== gameState.currentTurnIndex) return;

    const updatedPlayers = [...gameState.players];
    updatedPlayers[playerIdx].lastAction = amount > 0 ? `${amount}分` : "不叫";

    let newBaseBid = gameState.baseBid;
    let newLandlordId = gameState.landlordId;
    let nextPhase = GamePhase.Bidding;
    let nextTurn = (gameState.currentTurnIndex + 1) % 3;

    if (amount > newBaseBid) {
      newBaseBid = amount;
      newLandlordId = playerId;
    }

    // Simplified Bidding End: If score is 3 or everyone had a chance (logic simplified)
    // For demo: if someone calls 3, they win immediately. Or if we circled back.
    // Let's use strict: if 3, end. If 3 passes, restart. (Restart not impl, assume someone calls)
    
    if (amount === 3 || (amount > 0 && newBaseBid > 0 && Math.random() > 0.9)) { 
        // End bidding
        finalizeLandlord(newLandlordId || playerId, newBaseBid || 1);
        return; 
    }

    // Check if everyone passed? (omitted for brevity)
    
    broadcastState({
        ...gameState,
        players: updatedPlayers,
        baseBid: newBaseBid,
        landlordId: newLandlordId,
        currentTurnIndex: nextTurn
    });
  };

  const finalizeLandlord = (landlordId: string, bid: number) => {
      const updatedPlayers = gameState.players.map(p => {
          if (p.id === landlordId) {
              return { ...p, role: PlayerRole.Landlord, hand: sortHand([...p.hand, ...gameState.kittyCards]) };
          }
          return { ...p, role: PlayerRole.Peasant };
      });

      // Laizi Generation
      let laizi: number | null = null;
      if (gameState.config.enableLaizi) {
        // Pick a random rank from 3 to 2 (values 3-15)
        const randomVal = Math.floor(Math.random() * 13) + 3;
        laizi = randomVal as Rank; 
      }

      broadcastState({
          ...gameState,
          phase: GamePhase.Playing,
          players: updatedPlayers,
          baseBid: bid,
          landlordId: landlordId,
          currentTurnIndex: updatedPlayers.findIndex(p => p.id === landlordId),
          laiziRank: laizi
      });
  };

  const processPlay = (playerId: string, cards: Card[]) => {
      const playerIdx = gameState.players.findIndex(p => p.id === playerId);
      if (playerIdx !== gameState.currentTurnIndex) return;

      const player = gameState.players[playerIdx];
      
      // Validation (Host side)
      // Note: Client should also validate, but Host is source of truth.
      if (cards.length > 0 && !isValidPlay(cards, (gameState.lastPlayerId && gameState.lastPlayerId !== playerId) ? gameState.lastPlayedCards : [], gameState.laiziRank)) {
          console.log("Invalid Play detected by Host");
          return;
      }

      const newHand = player.hand.filter(c => !cards.find(played => played.id === c.id));
      const updatedPlayers = [...gameState.players];
      updatedPlayers[playerIdx] = { ...player, hand: newHand, lastAction: cards.length > 0 ? '出牌' : '不出' };

      // Check Win
      if (newHand.length === 0) {
          handleGameOver(playerId, updatedPlayers);
          return;
      }

      let nextTurn = (gameState.currentTurnIndex + 1) % 3;
      
      // Update last played logic
      let newLastPlayed = gameState.lastPlayedCards;
      let newLastPlayerId = gameState.lastPlayerId;

      if (cards.length > 0) {
          newLastPlayed = cards;
          newLastPlayerId = playerId;
          
          // Bomb/Rocket Multiplier
          const isBomb = cards.length === 4 && cards.every(c => c.value === cards[0].value);
          const isRocket = cards.length === 2 && cards[0].value >= 16 && cards[1].value >= 16;
          if (isBomb || isRocket) {
              // Double multiplier logic would go here
              // broadcastState({... multiplier * 2 })
          }
      } else {
          // Pass
          // If two players pass, newLastPlayed cleared? No, handled by client logic "isMyTurnToLead"
      }

      // Check if next player is the one who played the last cards (everyone else passed)
      // Actually simpler: store lastPlayerId. If next turn == lastPlayerId, clear lastPlayedCards.
      if (updatedPlayers[nextTurn].id === newLastPlayerId) {
          newLastPlayed = []; // They get to lead
      }

      broadcastState({
          ...gameState,
          players: updatedPlayers,
          lastPlayedCards: newLastPlayed,
          lastPlayerId: newLastPlayerId,
          currentTurnIndex: nextTurn
      });
  };

  const handleGameOver = (winnerId: string, finalPlayers: Player[]) => {
      const winner = finalPlayers.find(p => p.id === winnerId);
      const isLandlordWin = winner?.role === PlayerRole.Landlord;
      
      // Calculate scores
      const score = gameState.baseBid * gameState.multiplier * 100; // Simple calc
      const updatedPlayers = finalPlayers.map(p => {
          let change = 0;
          if (isLandlordWin) {
              change = (p.role === PlayerRole.Landlord) ? score * 2 : -score;
          } else {
              change = (p.role === PlayerRole.Landlord) ? -score * 2 : score;
          }
          return { ...p, beans: p.beans + change, ready: false };
      });

      broadcastState({
          ...gameState,
          phase: GamePhase.GameOver,
          players: updatedPlayers,
          winnerId: winnerId
      });
  };

  // --- Bot Logic Hook (Host Only) ---
  useEffect(() => {
    if (!isHost || gameState.phase === GamePhase.GameOver) return;
    
    const currentPlayer = gameState.players[gameState.currentTurnIndex];
    if (currentPlayer && currentPlayer.isBot) {
        const timer = setTimeout(() => {
            if (gameState.phase === GamePhase.Bidding) {
                const bid = getBotBid(currentPlayer.hand);
                processBid(currentPlayer.id, bid);
            } else if (gameState.phase === GamePhase.Playing) {
                const isLeading = !gameState.lastPlayerId || gameState.lastPlayerId === currentPlayer.id;
                const lastCards = isLeading ? [] : gameState.lastPlayedCards;
                const moves = getBotMove(currentPlayer.hand, lastCards, gameState.laiziRank);
                processPlay(currentPlayer.id, moves);
            }
        }, 1500); // Bot thinking time
        return () => clearTimeout(timer);
    }
  }, [gameState, isHost]);


  // --- Client Actions ---

  const sendBid = (amount: number) => {
    if (isHost) processBid(peerId, amount);
    else connectionsRef.current[0].send({ type: 'ACTION_BID', amount });
  };

  const sendPlay = (cards: Card[]) => {
    if (isHost) processPlay(peerId, cards);
    else connectionsRef.current[0].send({ type: 'ACTION_PLAY', cards });
    setSelectedCards([]);
  };

  const sendRestart = () => {
    if (isHost) startNewGame(gameState.players);
    else connectionsRef.current[0].send({ type: 'ACTION_RESTART' });
  };

  // --- Interaction Logic ---

  const toggleCardSelection = (cardId: string, forceState?: boolean) => {
    setSelectedCards(prev => {
      const isSelected = prev.includes(cardId);
      const shouldSelect = forceState !== undefined ? forceState : !isSelected;
      
      if (shouldSelect && !isSelected) return [...prev, cardId];
      if (!shouldSelect && isSelected) return prev.filter(id => id !== cardId);
      return prev;
    });
  };

  // Swipe Handlers
  const handleTouchStart = (e: React.TouchEvent, cardId: string) => {
    const isSelected = selectedCards.includes(cardId);
    swipeRef.current = {
      active: true,
      mode: !isSelected, // If starting on selected, mode is deselect
      processed: new Set([cardId]),
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
    };
    toggleCardSelection(cardId, !isSelected);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeRef.current.active) return;
    e.preventDefault(); // Prevent scroll
    
    const touch = e.touches[0];
    const target = document.elementFromPoint(touch.clientX, touch.clientY);
    const cardElement = target?.closest('[data-card-id]') as HTMLElement;
    
    if (cardElement) {
      const cardId = cardElement.getAttribute('data-card-id')!;
      if (!swipeRef.current.processed.has(cardId)) {
        toggleCardSelection(cardId, swipeRef.current.mode);
        swipeRef.current.processed.add(cardId);
      }
    }
  };

  const handleTouchEnd = () => {
    swipeRef.current.active = false;
    swipeRef.current.processed.clear();
  };

  const getMyPlayer = () => gameState.players.find(p => p.id === peerId);
  const isMyTurn = gameState.players[gameState.currentTurnIndex]?.id === peerId;

  // AI
  const fetchAdvice = async () => {
    const me = getMyPlayer();
    if (!me) return;
    setLoadingAi(true);
    const advice = await getGameAdvice(me.hand, gameState, peerId);
    setAiAdvice(advice);
    setLoadingAi(false);
  };


  // --- Rendering ---

  if (gameState.phase === GamePhase.Lobby) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-800 to-gray-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-md p-8 rounded-3xl shadow-2xl w-full max-w-lg border border-white/20">
          <h1 className="text-4xl font-black text-center text-white mb-8 drop-shadow-md tracking-wider">
            Gemini 斗地主
          </h1>
          
          <div className="space-y-6">
            <div className="bg-black/20 p-4 rounded-xl">
               <label className="block text-gray-300 text-sm mb-2">我的名字</label>
               <input 
                 type="text" 
                 value={playerName} 
                 onChange={e => setPlayerName(e.target.value)}
                 className="w-full bg-white/10 border border-white/30 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
               />
            </div>

            {connStatus !== '就绪' && connStatus !== '已连接房主' ? (
               <div className="text-center text-yellow-300 animate-pulse">{connStatus}</div>
            ) : (
              <>
                {!isHost && !targetPeerId ? (
                   <div className="grid grid-cols-1 gap-4">
                     <GameButton onClick={() => createRoom(false)}>创建房间 (我来打牌)</GameButton>
                     <GameButton onClick={() => createRoom(true)} variant="secondary">创建专用房间 (观战/投屏)</GameButton>
                     <GameButton onClick={joinRoom} variant="success">加入房间</GameButton>
                   </div>
                ) : (
                  <div className="text-center space-y-4">
                    <div className="text-xl text-white font-bold">房间号 (ID)</div>
                    <div className="text-2xl font-mono bg-black/40 p-3 rounded-lg select-all text-green-400 break-all">
                      {isHost ? peerId : targetPeerId}
                    </div>
                    
                    {isHost && (
                        <div className="flex items-center justify-center space-x-2 text-white">
                            <input 
                                type="checkbox" 
                                id="laizi"
                                checked={enableLaizi}
                                onChange={e => setEnableLaizi(e.target.checked)}
                                className="w-5 h-5 accent-green-500"
                            />
                            <label htmlFor="laizi" className="cursor-pointer select-none">启用癞子玩法</label>
                        </div>
                    )}

                    <div className="py-4">
                       <h3 className="text-white/70 mb-2">当前玩家 ({gameState.players.length}/3)</h3>
                       <div className="space-y-2">
                         {gameState.players.map(p => (
                           <div key={p.id} className="bg-white/5 p-2 rounded flex justify-between items-center text-white">
                             <span>{p.name}</span>
                             {p.isBot && <span className="text-xs bg-gray-600 px-1 rounded">BOT</span>}
                           </div>
                         ))}
                       </div>
                    </div>

                    {isHost && (
                      <div className="flex gap-2 justify-center">
                        <GameButton onClick={addBot} variant="secondary" disabled={gameState.players.length >= 3}>+ 机器人</GameButton>
                        <GameButton onClick={() => startNewGame(gameState.players)} disabled={gameState.players.length < 3}>开始游戏</GameButton>
                      </div>
                    )}
                    
                    {!isHost && <div className="text-white animate-pulse">等待房主开始...</div>}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // --- Playing View ---
  
  // Identify seats relative to View Point
  let myIdx = gameState.players.findIndex(p => p.id === peerId);
  const dedicatedMode = gameState.config.isDedicated;
  
  if (dedicatedMode) {
      // Dedicated Host View: Show everyone clearly
      // P1 Left, P2 Center, P3 Right? Or P1 Bottom, P2 Right, P3 Left (Standard rotation)
      // Let's do: P0 (Left), P1 (Center), P2 (Right) for parity
      myIdx = -1; // Spectator
  } else if (myIdx === -1) {
      // Spectator joined later? or bug
      return <div>观战模式 (暂未完全适配非Host观战)</div>;
  }

  // Helper to get player relative to me
  // Indices: 0, 1, 2
  // If I am 0: Right is 1, Left is 2
  // If I am 1: Right is 2, Left is 0
  // Right = (me + 1) % 3
  // Left = (me + 2) % 3
  
  // Dedicated Mode:
  // Center = 1, Left = 0, Right = 2
  
  let playerMe = dedicatedMode ? null : gameState.players[myIdx];
  let playerRight = dedicatedMode ? gameState.players[2] : gameState.players[(myIdx + 1) % 3];
  let playerLeft = dedicatedMode ? gameState.players[0] : gameState.players[(myIdx + 2) % 3];
  let playerTop = dedicatedMode ? gameState.players[1] : null; 

  const renderHand = (player: Player | null, position: 'bottom' | 'left' | 'right' | 'top') => {
    if (!player) return null;
    
    // In dedicated mode, show all hands face up. 
    // In normal mode, only show My hand face up. Others face down unless game over.
    const isMine = position === 'bottom' && !dedicatedMode;
    const showFace = isMine || dedicatedMode || gameState.phase === GamePhase.GameOver;
    
    // Layout adjustments
    const isSide = position === 'left' || position === 'right';
    const containerClass = isSide 
        ? "flex flex-col items-center space-y-[-3rem]" // Vertical stack
        : "flex justify-center flex-wrap"; // Horizontal
        
    const cardScale = isSide ? true : false; // Smaller cards on side
    
    // Dynamic spacing for bottom hand on mobile
    const handSize = player.hand.length;
    let overlapStyle = {};
    if (position === 'bottom') {
        const overlapAmt = handSize > 10 ? '-2.5rem' : '-2rem';
        overlapStyle = { marginLeft: overlapAmt };
    }

    return (
      <div className={`relative ${position === 'left' ? 'order-1' : position === 'right' ? 'order-3' : 'order-2 w-full'} p-2 transition-all`}>
        {/* Player Info Badge */}
        <div className={`
           absolute z-20 bg-black/60 text-white px-3 py-1 rounded-full backdrop-blur-sm text-sm border border-white/10 shadow-lg
           ${position === 'left' ? '-right-12 top-0' : ''}
           ${position === 'right' ? '-left-12 top-0' : ''}
           ${position === 'top' ? 'bottom-[-3rem] left-1/2 -translate-x-1/2' : ''}
           ${position === 'bottom' ? 'top-[-3rem] left-6' : ''}
        `}>
          <div className="flex items-center gap-2">
             <span className="font-bold">{player.name}</span>
             <span className="text-yellow-400">💰 {player.beans}</span>
             {player.role === PlayerRole.Landlord && <span className="bg-yellow-600 px-1 rounded text-xs">地主</span>}
             {gameState.landlordId === player.id && gameState.phase === GamePhase.Bidding && <span className="text-xs animate-pulse">叫牌中...</span>}
          </div>
          <div className="text-xs text-gray-300 mt-1 h-4">{player.lastAction}</div>
        </div>

        {/* Cards */}
        <div 
          className={containerClass} 
          // For touch handling on bottom hand
          onTouchMove={position === 'bottom' ? handleTouchMove : undefined}
          onTouchEnd={position === 'bottom' ? handleTouchEnd : undefined}
        >
          {player.hand.map((card, idx) => (
             showFace ? (
                <CardComponent 
                    key={card.id} 
                    card={card} 
                    small={isSide} 
                    selected={selectedCards.includes(card.id)}
                    isLaizi={gameState.laiziRank === card.rank}
                    onClick={() => isMine && toggleCardSelection(card.id)}
                    onTouchStart={isMine ? (e) => handleTouchStart(e, card.id) : undefined}
                    data-card-id={card.id}
                    style={idx > 0 ? (isSide ? { marginTop: '-5rem' } : overlapStyle) : {}}
                />
             ) : (
                // Card Back
                <div 
                    key={card.id}
                    className={`
                        bg-blue-800 border-2 border-white rounded-lg shadow-md
                        ${isSide ? 'w-10 h-14' : 'w-16 h-24'}
                    `}
                    style={idx > 0 ? (isSide ? { marginTop: '-5rem' } : { marginLeft: '-2.5rem' }) : {}}
                />
             )
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 felt-bg flex flex-col overflow-hidden select-none">
       {/* Top Bar: Info & Kitty */}
       <div className="h-16 bg-black/30 backdrop-blur-sm flex justify-between items-center px-4 z-50 border-b border-white/10">
           <div className="text-white text-xs md:text-sm opacity-80">
              底分: <span className="text-yellow-400 font-bold">{gameState.baseBid}</span> | 
              倍数: <span className="text-yellow-400 font-bold">x{gameState.multiplier}</span> | 
              {gameState.config.enableLaizi && (
                  <span className="ml-2 text-green-300">癞子模式</span>
              )}
           </div>

           {/* Kitty Cards */}
           <div className="flex gap-2">
               {gameState.kittyCards.map((c, i) => (
                   <div key={i} className="transform scale-75 origin-top">
                       {gameState.phase !== GamePhase.Dealing && gameState.phase !== GamePhase.Bidding ? (
                           <CardComponent card={c} small isLaizi={gameState.laiziRank === c.rank} />
                       ) : (
                           <div className="w-10 h-14 bg-blue-800 border border-white rounded" />
                       )}
                   </div>
               ))}
           </div>
           
           <button onClick={() => setIsHost(false)} className="text-white/50 hover:text-white text-xs">退出</button>
       </div>

       {/* Main Table Area */}
       <div className="flex-1 relative flex justify-between items-center p-2 md:p-8">
           {/* Left Player */}
           <div className="h-full flex items-center justify-center w-24 md:w-32 z-10">
               {renderHand(playerLeft, 'left')}
           </div>

           {/* Center Area: Table Info / Played Cards / Top Player (Dedicated) */}
           <div className="flex-1 h-full flex flex-col items-center justify-center relative">
               
               {/* Dedicated Mode: Top Player */}
               {dedicatedMode && (
                   <div className="absolute top-4">
                       {renderHand(playerTop, 'top')}
                   </div>
               )}

               {/* Played Cards Area */}
               <div className="flex flex-col items-center justify-center min-h-[200px]">
                  {gameState.lastPlayedCards.length > 0 && (
                      <div className="bg-black/20 p-4 rounded-xl backdrop-blur-sm animate-fade-in-up">
                          <div className="flex">
                              {gameState.lastPlayedCards.map((c, i) => (
                                  <CardComponent 
                                    key={c.id} 
                                    card={c} 
                                    style={i > 0 ? { marginLeft: '-2rem' } : {}}
                                    isLaizi={gameState.laiziRank === c.rank}
                                  />
                              ))}
                          </div>
                          {gameState.lastPlayerId && (
                             <div className="text-center text-white/70 text-sm mt-2">
                                 {gameState.players.find(p => p.id === gameState.lastPlayerId)?.name}
                             </div>
                          )}
                      </div>
                  )}

                  {/* Winner Banner */}
                  {gameState.phase === GamePhase.GameOver && (
                      <div className="mt-8 animate-bounce">
                          <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-600 drop-shadow-lg">
                              {gameState.players.find(p => p.id === gameState.winnerId)?.name} 胜利!
                          </div>
                          {isHost && (
                              <GameButton onClick={() => startNewGame(gameState.players)} className="mt-4" variant="success">
                                  再来一局
                              </GameButton>
                          )}
                      </div>
                  )}
               </div>
           </div>

           {/* Right Player */}
           <div className="h-full flex items-center justify-center w-24 md:w-32 z-10">
               {renderHand(playerRight, 'right')}
           </div>
       </div>

       {/* Bottom Player (Me) Controls */}
       {!dedicatedMode && (
           <div className="pb-safe-area">
               {/* Action Bar */}
               <div className="h-16 flex items-center justify-center gap-4 mb-2 z-50 relative pointer-events-auto">
                   {/* Bidding Controls */}
                   {isMyTurn && gameState.phase === GamePhase.Bidding && (
                       <>
                           <GameButton onClick={() => sendBid(0)} variant="secondary">不叫</GameButton>
                           <GameButton onClick={() => sendBid(1)}>1分</GameButton>
                           <GameButton onClick={() => sendBid(2)}>2分</GameButton>
                           <GameButton onClick={() => sendBid(3)} variant="danger">3分</GameButton>
                       </>
                   )}

                   {/* Playing Controls */}
                   {isMyTurn && gameState.phase === GamePhase.Playing && (
                       <>
                           <GameButton onClick={() => sendPlay([])} variant="secondary">不出</GameButton>
                           <GameButton 
                               onClick={() => {
                                   const cards = selectedCards.map(id => playerMe!.hand.find(c => c.id === id)!);
                                   sendPlay(cards);
                               }}
                               variant="success"
                               disabled={selectedCards.length === 0}
                           >
                               出牌
                           </GameButton>
                           <GameButton onClick={fetchAdvice} variant="primary" disabled={loadingAi}>
                               {loadingAi ? '...' : 'AI 提示'}
                           </GameButton>
                       </>
                   )}
                   
                   {/* AI Advice Bubble */}
                   {aiAdvice && (
                       <div className="absolute bottom-20 bg-white text-gray-800 p-3 rounded-xl shadow-lg text-sm max-w-xs animate-fade-in border border-blue-200">
                           <div className="font-bold text-blue-600 mb-1">Gemini 建议:</div>
                           {aiAdvice}
                       </div>
                   )}
               </div>

               {/* My Hand */}
               <div className="flex justify-center pb-4 min-h-[140px] overflow-visible">
                   {renderHand(playerMe, 'bottom')}
               </div>
           </div>
       )}
    </div>
  );
};

export default App;