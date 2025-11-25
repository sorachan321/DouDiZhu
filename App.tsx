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

// Prefix to avoid collisions on public PeerJS server
const ROOM_ID_PREFIX = 'gemini-ddz-v1-';

// UI Components
const GameButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'success' }> = ({ children, variant = 'primary', className, ...props }) => {
  const variants = {
    primary: 'from-blue-500 to-blue-700 border-blue-900 text-white hover:from-blue-400 hover:to-blue-600',
    secondary: 'from-slate-100 to-slate-300 border-slate-400 text-slate-800 hover:from-white hover:to-slate-200',
    danger: 'from-red-500 to-red-700 border-red-900 text-white hover:from-red-400 hover:to-red-600',
    success: 'from-emerald-500 to-emerald-700 border-emerald-900 text-white hover:from-emerald-400 hover:to-emerald-600',
  };

  return (
    <button
      className={`
        bg-gradient-to-b ${variants[variant]}
        font-bold py-3 px-8 rounded-2xl shadow-[0_4px_0_rgba(0,0,0,0.2)]
        active:shadow-none active:translate-y-[4px] active:border-t-4
        transition-all duration-100 uppercase tracking-widest text-lg
        disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0_rgba(0,0,0,0.2)]
        ${className || ''}
      `}
      {...props}
    >
      {children}
    </button>
  );
};

const App: React.FC = () => {
  // --- View State ---
  const [view, setView] = useState<'HOME' | 'LOBBY' | 'GAME'>('HOME');
  
  // --- Network State ---
  const [peerId, setPeerId] = useState<string>('');
  const [roomCode, setRoomCode] = useState<string>(''); // The 4-digit code
  const [connStatus, setConnStatus] = useState<string>('');
  const [isHost, setIsHost] = useState<boolean>(false);
  const [playerName, setPlayerName] = useState<string>(() => {
    return localStorage.getItem('ddz_player_name') || `玩家${Math.floor(Math.random() * 999)}`;
  });

  // --- Game Settings ---
  const [isDedicated, setIsDedicated] = useState<boolean>(false);
  const [enableLaizi, setEnableLaizi] = useState<boolean>(false);
  const [inputRoomCode, setInputRoomCode] = useState<string>('');

  // --- Game Data ---
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

  // --- Local Interaction ---
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [aiAdvice, setAiAdvice] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState<boolean>(false);

  // --- Refs ---
  const peerRef = useRef<any>(null);
  const connectionsRef = useRef<any[]>([]); // Store all connections (Host side) or Host connection (Guest side)
  const swipeRef = useRef<{
    active: boolean;
    mode: boolean;
    processed: Set<string>;
  }>({ active: false, mode: true, processed: new Set() });

  // Persist Name
  useEffect(() => {
    localStorage.setItem('ddz_player_name', playerName);
  }, [playerName]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);


  // =========================================================================================
  // NETWORK LOGIC
  // =========================================================================================

  // 1. Host Initialization
  const initHost = (dedicated: boolean) => {
    if (peerRef.current) peerRef.current.destroy();

    // Generate 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const fullId = `${ROOM_ID_PREFIX}${code}`;
    
    setConnStatus('正在创建房间...');
    
    try {
      const peer = new window.Peer(fullId, { debug: 1 });
      
      peer.on('open', (id: string) => {
        console.log('Host initialized:', id);
        setPeerId(id);
        setRoomCode(code);
        setIsHost(true);
        setIsDedicated(dedicated);
        setConnStatus('等待玩家加入...');
        peerRef.current = peer;
        connectionsRef.current = []; // Reset connections
        
        // Initial Game State
        const initialPlayers = dedicated ? [] : [{
          id: id,
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
        
        setView(dedicated ? 'LOBBY' : 'LOBBY'); // Host goes to lobby
      });

      peer.on('connection', (conn: any) => {
        console.log('Host received connection from:', conn.peer);
        
        conn.on('open', () => {
            console.log("Connection fully open:", conn.peer);
            // Add to connections list if not already there
            if (!connectionsRef.current.find(c => c.peer === conn.peer)) {
                connectionsRef.current.push(conn);
            }
            
            // Send current state immediately to the new connector so they know they connected
            // But we actually wait for JOIN_REQUEST to add them to players list
            // However, we can send a "Connected" ack if needed, but JOIN_REQUEST flow is fine.
        });

        conn.on('data', (data: NetworkMessage) => {
            console.log("Host received data:", data);
            handleData(data, conn.peer);
        });

        conn.on('close', () => {
            console.log("Connection closed:", conn.peer);
            connectionsRef.current = connectionsRef.current.filter(c => c.peer !== conn.peer);
            // Optional: Remove player from game if in lobby? 
            // For simplicity, we don't auto-remove in game, but in lobby we could.
             setGameState(prev => ({
                ...prev,
                players: prev.players.filter(p => p.id !== conn.peer)
            }));
        });
      });

      peer.on('error', (err: any) => {
        console.error('Host Error:', err);
        if (err.type === 'unavailable-id') {
            // Retry with new code if collision (rare)
            initHost(dedicated); 
        } else {
            setConnStatus(`创建失败: ${err.type}`);
        }
      });

    } catch (e) {
      console.error(e);
      setConnStatus('PeerJS 初始化失败');
    }
  };

  // 2. Guest Initialization & Join
  const initGuestAndJoin = () => {
    if (inputRoomCode.length !== 4) {
        alert("请输入4位房间号");
        return;
    }

    if (peerRef.current) peerRef.current.destroy();
    
    setConnStatus('正在连接服务器...');
    
    try {
      // Guest gets a random ID
      const peer = new window.Peer(null, { debug: 1 });

      peer.on('open', (id: string) => {
        console.log('Guest initialized:', id);
        setPeerId(id);
        setConnStatus(`正在搜索房间 ${inputRoomCode}...`);
        
        const hostId = `${ROOM_ID_PREFIX}${inputRoomCode}`;
        const conn = peer.connect(hostId, { reliable: true });

        conn.on('open', () => {
           console.log("Connected to Host!");
           setConnStatus('已连接，正在加入...');
           connectionsRef.current = [conn]; // Guest only connects to Host
           peerRef.current = peer;

           // Send Join Request
           conn.send({ type: 'JOIN_REQUEST', name: playerName });
        });

        conn.on('data', (data: NetworkMessage) => {
            console.log("Guest received data:", data);
            handleData(data, hostId);
        });

        conn.on('close', () => {
            alert("与房主断开连接");
            setView('HOME');
            setConnStatus('');
        });
        
        // Handle connection failure specifically
        setTimeout(() => {
            if (!conn.open) {
                setConnStatus('连接超时，房间可能不存在');
            }
        }, 5000);
      });

      peer.on('error', (err: any) => {
        console.error('Guest Error:', err);
        setConnStatus(`连接失败: ${err.type === 'peer-unavailable' ? '房间不存在' : err.type}`);
      });

    } catch (e) {
        console.error(e);
        setConnStatus('连接失败');
    }
  };

  // =========================================================================================
  // GAME LOGIC HANDLERS
  // =========================================================================================

  const broadcastState = (newState: GameState) => {
    setGameState(newState);
    // Filter out closed connections
    connectionsRef.current = connectionsRef.current.filter(c => c.open);
    connectionsRef.current.forEach(conn => {
      conn.send({ type: 'GAME_STATE_UPDATE', state: newState });
    });
  };

  const handleData = (data: NetworkMessage, fromPeerId: string) => {
    // HOST LOGIC
    if (isHost) {
      if (data.type === 'JOIN_REQUEST') {
        const currentPlayers = gameState.players;
        // Check if already joined
        if (currentPlayers.find(p => p.id === fromPeerId)) return;
        
        if (currentPlayers.length >= 3) {
            // Room full
            // Optionally send an error message back
            return; 
        }

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
      } 
      else if (data.type === 'ACTION_BID') {
        processBid(fromPeerId, data.amount!);
      } 
      else if (data.type === 'ACTION_PLAY') {
        processPlay(fromPeerId, data.cards!);
      } 
      else if (data.type === 'ACTION_RESTART') {
        startNewGame(gameState.players);
      }
    } 
    // GUEST LOGIC
    else {
      if (data.type === 'GAME_STATE_UPDATE' && data.state) {
        setGameState(data.state);
        setView(data.state.phase === GamePhase.Lobby ? 'LOBBY' : 'GAME');
        setEnableLaizi(data.state.config.enableLaizi);
        setIsDedicated(data.state.config.isDedicated);
      }
    }
  };

  // --- Host Actions ---

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

  const startNewGame = (players: Player[]) => {
    const deck = shuffleDeck(createDeck());
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
      phase: GamePhase.Dealing,
      deck: [],
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

    setTimeout(() => {
        broadcastState({
            ...gameState,
            phase: GamePhase.Bidding,
            players: updatedPlayers, // Ensure sync
            kittyCards: kitty,
            currentTurnIndex: gameState.currentTurnIndex, // keep random start
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
    let nextTurn = (gameState.currentTurnIndex + 1) % 3;

    if (amount > newBaseBid) {
      newBaseBid = amount;
      newLandlordId = playerId;
    }
    
    // Logic to end bidding
    const allBidded = updatedPlayers.every(p => p.lastAction !== undefined); // Simplified check
    // Actually, simple logic: if 3 is bid, end immediately.
    // Or if everyone has had a chance. For simplicity: Bid 3 ends, or after 3 turns pick highest.
    
    // Let's stick to simple "Call 3 ends" or "Everyone called once" logic.
    // We'll just use a simple turn counter or just check if amount is 3.
    // Or if loop back to start?
    // Simplified: If bid 3, game on. If all 3 passed (baseBid 0), restart? (Not implemented restart yet)

    if (amount === 3) {
        finalizeLandlord(newLandlordId!, 3);
        return;
    }

    // Check if 3 turns passed? (Need more complex state for standard rules)
    // For this demo, let's just rotate. If it comes back to first player and someone bid, done.
    // If nobody bid after 3 turns? Restart. (Skip for now)

    // Just check if we have a landlord and everyone spoke?
    // Let's use a simpler heuristic:
    // If it's the 3rd turn (how to track?)
    // Okay, for robustness in this simple version:
    // We just play endlessly until someone hits 3, OR we can add a 'pass' counter.
    // Let's just rely on players picking 1, 2, 3.
    
    // To make it playable: If current bid > 0 and next player passes...
    // Let's just rotate.
    
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

      let laizi: number | null = null;
      if (gameState.config.enableLaizi) {
        laizi = (Math.floor(Math.random() * 13) + 3) as Rank; 
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

      if (cards.length > 0 && !isValidPlay(cards, (gameState.lastPlayerId && gameState.lastPlayerId !== playerId) ? gameState.lastPlayedCards : [], gameState.laiziRank)) {
          return; // Invalid
      }

      const newHand = player.hand.filter(c => !cards.find(played => played.id === c.id));
      const updatedPlayers = [...gameState.players];
      updatedPlayers[playerIdx] = { ...player, hand: newHand, lastAction: cards.length > 0 ? '出牌' : '不出' };

      if (newHand.length === 0) {
          handleGameOver(playerId, updatedPlayers);
          return;
      }

      let nextTurn = (gameState.currentTurnIndex + 1) % 3;
      let newLastPlayed = gameState.lastPlayedCards;
      let newLastPlayerId = gameState.lastPlayerId;

      if (cards.length > 0) {
          newLastPlayed = cards;
          newLastPlayerId = playerId;
      } else if (updatedPlayers[nextTurn].id === newLastPlayerId) {
          newLastPlayed = []; // Everyone passed, leader clears
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
      const score = gameState.baseBid * gameState.multiplier * 100;
      
      const updatedPlayers = finalPlayers.map(p => {
          let change = 0;
          if (isLandlordWin) change = (p.role === PlayerRole.Landlord) ? score * 2 : -score;
          else change = (p.role === PlayerRole.Landlord) ? -score * 2 : score;
          return { ...p, beans: p.beans + change, ready: false };
      });

      broadcastState({
          ...gameState,
          phase: GamePhase.GameOver,
          players: updatedPlayers,
          winnerId: winnerId
      });
  };

  // Bot logic
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
        }, 1500);
        return () => clearTimeout(timer);
    }
  }, [gameState, isHost]);


  // --- Client Actions ---
  const sendAction = (type: NetworkMessage['type'], payload: any = {}) => {
      if (isHost) {
          if (type === 'ACTION_BID') processBid(peerId, payload.amount);
          if (type === 'ACTION_PLAY') processPlay(peerId, payload.cards);
          if (type === 'ACTION_RESTART') startNewGame(gameState.players);
      } else {
          connectionsRef.current[0]?.send({ type, ...payload });
      }
      setAiAdvice('');
  };


  // --- Interactions ---
  const toggleCardSelection = (cardId: string, forceState?: boolean) => {
    setSelectedCards(prev => {
      const isSelected = prev.includes(cardId);
      const shouldSelect = forceState !== undefined ? forceState : !isSelected;
      if (shouldSelect && !isSelected) return [...prev, cardId];
      if (!shouldSelect && isSelected) return prev.filter(id => id !== cardId);
      return prev;
    });
  };

  const handleTouchStart = (e: React.TouchEvent, cardId: string) => {
    const isSelected = selectedCards.includes(cardId);
    swipeRef.current = {
      active: true,
      mode: !isSelected,
      processed: new Set([cardId]),
    };
    toggleCardSelection(cardId, !isSelected);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!swipeRef.current.active) return;
    e.preventDefault(); 
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

  const fetchAdvice = async () => {
    const me = gameState.players.find(p => p.id === peerId);
    if (!me) return;
    setLoadingAi(true);
    const advice = await getGameAdvice(me.hand, gameState, peerId);
    setAiAdvice(advice);
    setLoadingAi(false);
  };


  // =========================================================================================
  // RENDER
  // =========================================================================================

  if (view === 'HOME') {
      return (
        <div className="min-h-screen bg-gradient-to-br from-green-900 to-slate-900 flex items-center justify-center p-4">
          <div className="bg-white/10 backdrop-blur-xl p-8 rounded-3xl shadow-2xl w-full max-w-md border border-white/20 text-center animate-fade-in-up">
            <div className="text-6xl mb-6">🃏</div>
            <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-200 mb-8 tracking-wider drop-shadow-sm">
              Gemini 斗地主
            </h1>
            
            <div className="space-y-6">
              <div className="bg-black/30 p-4 rounded-2xl border border-white/10">
                 <label className="block text-blue-200 text-sm font-bold mb-2 uppercase tracking-wide">你的昵称</label>
                 <input 
                   type="text" 
                   value={playerName} 
                   onChange={e => setPlayerName(e.target.value)}
                   className="w-full bg-white/5 border border-white/20 rounded-xl px-4 py-3 text-white text-center font-bold text-lg focus:outline-none focus:ring-2 focus:ring-yellow-400 placeholder-white/20"
                   placeholder="请输入名字"
                 />
              </div>

              {connStatus && (
                  <div className="text-yellow-300 bg-yellow-900/30 py-2 rounded-lg text-sm animate-pulse border border-yellow-500/30">
                      {connStatus}
                  </div>
              )}

              <div className="grid gap-4">
                  <div className="relative group">
                     <GameButton onClick={() => setView('LOBBY')} className="w-full">创建房间</GameButton>
                  </div>
                  
                  <div className="bg-white/5 p-4 rounded-2xl border border-white/10 space-y-3">
                      <input 
                        type="tel" 
                        maxLength={4}
                        value={inputRoomCode}
                        onChange={e => setInputRoomCode(e.target.value)}
                        placeholder="输入4位房间号"
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white text-center font-mono text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-green-400"
                      />
                      <GameButton onClick={initGuestAndJoin} variant="success" className="w-full" disabled={inputRoomCode.length !== 4}>
                          加入房间
                      </GameButton>
                  </div>
              </div>
            </div>
          </div>
        </div>
      );
  }

  // Helper render for Create Room Setup (Sub-view of LOBBY logic actually, but simpler to keep in LOBBY phase)
  // Wait, if view is LOBBY and we are NOT connected, we show setup? 
  // No, let's use a setup state.
  if (view === 'LOBBY' && !peerId && !inputRoomCode) {
      // Setup Host
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
             <div className="bg-slate-800 p-8 rounded-3xl max-w-sm w-full border border-slate-700 text-center">
                 <h2 className="text-2xl text-white font-bold mb-6">房间设置</h2>
                 <div className="space-y-4 mb-8 text-left">
                     <label className="flex items-center space-x-3 text-white bg-slate-700 p-4 rounded-xl cursor-pointer hover:bg-slate-600 transition">
                         <input type="checkbox" checked={enableLaizi} onChange={e => setEnableLaizi(e.target.checked)} className="w-6 h-6 accent-yellow-400" />
                         <span className="flex-1">🎲 启用癞子玩法</span>
                     </label>
                     <label className="flex items-center space-x-3 text-white bg-slate-700 p-4 rounded-xl cursor-pointer hover:bg-slate-600 transition">
                         <input type="checkbox" checked={isDedicated} onChange={e => setIsDedicated(e.target.checked)} className="w-6 h-6 accent-blue-400" />
                         <div>
                             <div className="font-bold">🖥️ 专用房间 (观战模式)</div>
                             <div className="text-xs text-slate-400">电脑仅作为屏幕，不用来打牌</div>
                         </div>
                     </label>
                 </div>
                 <div className="flex gap-4">
                     <GameButton onClick={() => setView('HOME')} variant="secondary" className="flex-1">返回</GameButton>
                     <GameButton onClick={() => initHost(isDedicated)} className="flex-1">创建</GameButton>
                 </div>
             </div>
        </div>
      );
  }

  // ACTUAL LOBBY (Connected)
  if (view === 'LOBBY') {
      return (
        <div className="min-h-screen bg-gradient-to-b from-slate-800 to-slate-900 flex items-center justify-center p-4">
            <div className="w-full max-w-2xl bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 text-center relative overflow-hidden">
                {/* Decoration */}
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>

                <div className="mb-8">
                    <h2 className="text-slate-400 text-sm uppercase tracking-widest mb-2">Room Code</h2>
                    <div className="text-6xl font-black font-mono text-white tracking-widest drop-shadow-lg">
                        {roomCode || inputRoomCode}
                    </div>
                    {isDedicated && <div className="mt-2 inline-block bg-blue-600/30 text-blue-300 px-3 py-1 rounded-full text-xs border border-blue-500/30">观战模式</div>}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    {[0, 1, 2].map(i => {
                        const p = gameState.players[i];
                        return (
                            <div key={i} className={`p-4 rounded-2xl border-2 transition-all ${p ? 'bg-slate-700/50 border-green-500/50' : 'bg-slate-800/50 border-dashed border-slate-600'}`}>
                                {p ? (
                                    <>
                                        <div className="text-4xl mb-2">{p.isBot ? '🤖' : '👤'}</div>
                                        <div className="font-bold text-white truncate">{p.name}</div>
                                        <div className="text-xs text-green-400">已准备</div>
                                    </>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-500">
                                        <div className="text-2xl mb-1">+</div>
                                        <div>等待加入</div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="flex flex-wrap justify-center gap-4">
                    {isHost && (
                        <>
                            <GameButton onClick={addBot} variant="secondary" disabled={gameState.players.length >= 3}>+ 机器人</GameButton>
                            <GameButton onClick={() => sendAction('ACTION_RESTART')} disabled={gameState.players.length < 3} variant="success">开始游戏</GameButton>
                        </>
                    )}
                    {!isHost && <div className="text-white/50 animate-pulse">等待房主开始...</div>}
                    
                    <button onClick={() => window.location.reload()} className="absolute top-4 right-4 text-slate-500 hover:text-white">✕</button>
                </div>
            </div>
        </div>
      );
  }

  // --- GAME VIEW ---
  
  let myIdx = gameState.players.findIndex(p => p.id === peerId);
  const dedicatedMode = gameState.config.isDedicated;
  
  if (dedicatedMode) myIdx = -1; // Spectator

  // Helper to get player relative to me
  // Top is usually 2 away, Left 2 away/1 away?
  // Logic: Me (Bottom), Right (Next), Top (Partner/Opp), Left (Prev)?
  // Standard DouDizhu is 3 players.
  // Relative indices: 0 (Me), 1 (Right), 2 (Left)
  
  let playerMe = dedicatedMode ? null : gameState.players[myIdx];
  let playerRight = dedicatedMode ? gameState.players[1] : gameState.players[(myIdx + 1) % 3];
  let playerLeft = dedicatedMode ? gameState.players[2] : gameState.players[(myIdx + 2) % 3];
  let playerTop = dedicatedMode ? gameState.players[0] : null; 

  // Fix ordering for Dedicated mode (0=TopLeft?, 1=Top?, 2=TopRight?)
  // Actually dedicated mode usually puts:
  // Player 0: Left
  // Player 1: Top (or Center)
  // Player 2: Right
  if (dedicatedMode) {
      playerLeft = gameState.players[0];
      playerTop = gameState.players[1];
      playerRight = gameState.players[2];
  }

  const renderHand = (player: Player | null, position: 'bottom' | 'left' | 'right' | 'top') => {
    if (!player) return null;
    
    const isMine = position === 'bottom' && !dedicatedMode;
    const showFace = isMine || dedicatedMode || gameState.phase === GamePhase.GameOver;
    const isSide = position === 'left' || position === 'right';
    
    const containerClass = isSide 
        ? "flex flex-col items-center space-y-[-2.5rem] py-4" 
        : "flex justify-center items-center -space-x-8";
        
    const isActive = gameState.players[gameState.currentTurnIndex]?.id === player.id;
    
    return (
      <div className={`relative ${position === 'left' ? 'order-1' : position === 'right' ? 'order-3' : 'order-2 w-full'} transition-all`}>
        {/* Info Badge */}
        <div className={`
           absolute z-20 flex flex-col items-center
           ${position === 'left' ? '-right-16 top-1/2 -translate-y-1/2' : ''}
           ${position === 'right' ? '-left-16 top-1/2 -translate-y-1/2' : ''}
           ${position === 'top' ? 'bottom-[-4rem] left-1/2 -translate-x-1/2' : ''}
           ${position === 'bottom' ? 'top-[-5rem] left-4 md:left-20' : ''}
        `}>
             <div className={`
                relative px-4 py-2 rounded-2xl border-2 shadow-lg backdrop-blur-md transition-all
                ${isActive ? 'bg-yellow-500/20 border-yellow-400 scale-110' : 'bg-black/40 border-white/10'}
             `}>
                 <div className="font-bold text-white text-sm md:text-base whitespace-nowrap">{player.name}</div>
                 <div className="flex items-center justify-center gap-1 text-xs text-yellow-300">
                     <span>💰 {player.beans}</span>
                 </div>
                 {player.role === PlayerRole.Landlord && (
                     <div className="absolute -top-3 -right-2 bg-gradient-to-r from-red-500 to-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full shadow-sm border border-white/20">
                         地主
                     </div>
                 )}
                 {/* Action Status Bubble */}
                 {player.lastAction && (
                     <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-white text-slate-900 text-xs px-2 py-1 rounded shadow whitespace-nowrap font-bold">
                         {player.lastAction}
                     </div>
                 )}
             </div>
        </div>

        {/* Cards Container */}
        <div 
          className={containerClass} 
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
                    style={{ 
                        zIndex: idx,
                        transform: isActive && isSide ? 'scale(1.05)' : 'scale(1)'
                    }}
                />
             ) : (
                <div 
                    key={card.id}
                    className={`
                        bg-gradient-to-br from-blue-700 to-blue-900 border border-blue-400/30 rounded-lg shadow-md
                        ${isSide ? 'w-10 h-14' : 'w-20 h-28'}
                    `}
                    style={{ zIndex: idx }}
                />
             )
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 felt-bg flex flex-col overflow-hidden select-none">
       {/* --- Top Bar --- */}
       <div className="h-14 bg-black/20 backdrop-blur-md flex justify-between items-center px-4 z-50 border-b border-white/5">
           <div className="flex items-center space-x-4">
              <div className="bg-black/30 px-3 py-1 rounded-full border border-white/10 text-xs text-white/80">
                  <span className="text-slate-400 mr-2">房间</span>
                  <span className="font-mono font-bold text-yellow-400 tracking-widest">{roomCode || inputRoomCode}</span>
              </div>
              <div className="hidden md:block text-white/60 text-xs">
                  底分 <span className="text-white">{gameState.baseBid}</span>
                  <span className="mx-2">|</span>
                  倍数 <span className="text-yellow-400">x{gameState.multiplier}</span>
              </div>
           </div>

           {/* Top Center Kitty */}
           <div className="absolute left-1/2 -translate-x-1/2 top-2 flex gap-1">
               {gameState.kittyCards.map((c, i) => (
                   <div key={i} className="transform scale-75 origin-top hover:scale-100 transition-transform z-50">
                       {gameState.phase !== GamePhase.Dealing && gameState.phase !== GamePhase.Bidding ? (
                           <CardComponent card={c} small isLaizi={gameState.laiziRank === c.rank} />
                       ) : (
                           <div className="w-10 h-14 bg-blue-900/50 border border-white/20 rounded" />
                       )}
                   </div>
               ))}
           </div>
           
           <button onClick={() => window.location.reload()} className="text-white/50 hover:text-white text-sm">退出</button>
       </div>

       {/* --- Main Table --- */}
       <div className="flex-1 relative flex justify-between items-center px-2 py-4 md:p-8">
           
           {/* Left Position */}
           <div className="h-full flex items-center justify-center w-20 md:w-32 z-10">
               {renderHand(playerLeft, 'left')}
           </div>

           {/* Center Area */}
           <div className="flex-1 h-full flex flex-col items-center justify-center relative">
               
               {/* Dedicated Top Player */}
               {dedicatedMode && (
                   <div className="absolute top-0 w-full flex justify-center">
                       {renderHand(playerTop, 'top')}
                   </div>
               )}

               {/* Table Center (Played Cards) */}
               <div className="flex flex-col items-center justify-center w-full min-h-[160px]">
                  {gameState.lastPlayedCards.length > 0 && (
                      <div className="bg-black/10 p-6 rounded-3xl backdrop-blur-[2px] animate-fade-in-up border border-white/5 shadow-2xl">
                          <div className="flex -space-x-8">
                              {gameState.lastPlayedCards.map((c, i) => (
                                  <CardComponent 
                                    key={c.id} 
                                    card={c} 
                                    isLaizi={gameState.laiziRank === c.rank}
                                    style={{zIndex: i}}
                                  />
                              ))}
                          </div>
                      </div>
                  )}

                  {/* Winner Modal */}
                  {gameState.phase === GamePhase.GameOver && (
                      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
                          <div className="bg-white p-8 rounded-3xl shadow-2xl text-center animate-bounce">
                              <div className="text-6xl mb-4">🏆</div>
                              <div className="text-3xl font-black text-slate-800 mb-2">
                                  {gameState.players.find(p => p.id === gameState.winnerId)?.name} 获胜!
                              </div>
                              <div className="text-slate-500 mb-6">
                                  {gameState.players.find(p => p.id === gameState.winnerId)?.role === PlayerRole.Landlord ? '地主' : '农民'}胜利
                              </div>
                              {isHost && (
                                  <GameButton onClick={() => sendAction('ACTION_RESTART')} variant="success">
                                      再来一局
                                  </GameButton>
                              )}
                              {!isHost && <div className="text-sm text-slate-400">等待房主重开...</div>}
                          </div>
                      </div>
                  )}
               </div>
           </div>

           {/* Right Position */}
           <div className="h-full flex items-center justify-center w-20 md:w-32 z-10">
               {renderHand(playerRight, 'right')}
           </div>
       </div>

       {/* --- Bottom Controls (Me) --- */}
       {!dedicatedMode && (
           <div className="pb-safe-area relative z-30">
               {/* Controls Bar */}
               <div className="h-16 flex items-center justify-center gap-3 mb-2 px-4 pointer-events-auto">
                   
                   {/* Bidding */}
                   {gameState.players[gameState.currentTurnIndex]?.id === peerId && gameState.phase === GamePhase.Bidding && (
                       <>
                           <GameButton onClick={() => sendAction('ACTION_BID', { amount: 0 })} variant="secondary" className="px-6">不叫</GameButton>
                           <GameButton onClick={() => sendAction('ACTION_BID', { amount: 1 })} className="px-6">1分</GameButton>
                           <GameButton onClick={() => sendAction('ACTION_BID', { amount: 2 })} className="px-6">2分</GameButton>
                           <GameButton onClick={() => sendAction('ACTION_BID', { amount: 3 })} variant="danger" className="px-6">3分</GameButton>
                       </>
                   )}

                   {/* Playing */}
                   {gameState.players[gameState.currentTurnIndex]?.id === peerId && gameState.phase === GamePhase.Playing && (
                       <>
                           <GameButton onClick={() => sendAction('ACTION_PLAY', { cards: [] })} variant="secondary">不出</GameButton>
                           <GameButton 
                               onClick={() => {
                                   const cards = selectedCards.map(id => playerMe!.hand.find(c => c.id === id)!);
                                   sendAction('ACTION_PLAY', { cards });
                                   setSelectedCards([]);
                               }}
                               variant="success"
                               disabled={selectedCards.length === 0}
                           >
                               出牌
                           </GameButton>
                           <GameButton onClick={fetchAdvice} variant="primary" disabled={loadingAi} className="bg-gradient-to-r from-indigo-500 to-purple-600 border-purple-800">
                               {loadingAi ? '✨' : 'AI 提示'}
                           </GameButton>
                       </>
                   )}
                   
                   {/* AI Bubble */}
                   {aiAdvice && (
                       <div className="absolute bottom-full mb-4 bg-white/90 backdrop-blur text-slate-800 p-4 rounded-2xl shadow-xl text-sm max-w-[200px] border border-white/50 animate-fade-in-up">
                           <div className="font-bold text-purple-600 mb-1 flex items-center gap-1">
                               <span>✨ Gemini</span>
                           </div>
                           {aiAdvice}
                       </div>
                   )}
               </div>

               {/* Hand */}
               <div className="flex justify-center pb-2 md:pb-6 min-h-[150px] overflow-visible w-full px-4">
                   {renderHand(playerMe, 'bottom')}
               </div>
           </div>
       )}
    </div>
  );
};

export default App;