import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../supabaseClient"; // Make sure your client is imported
//import { Card, SuitType } from "./CasinoTypes"; // Keep your clean Type structs!



// ==========================================
// 1. TYPES & DATA STRUCTS
// ==========================================
export type SuitType = "♠" | "♥" | "♦" | "♣";
export type TurnEntity = "player" | "ai1" | "ai2";

/*interface MMOCasinoGameProps {
  roomCode: string;   // Passed down from your lobby manager
  currentUserId: string; // The logged-in human user ID
}*/

//i wonder if i should delete this
interface CasinoGameProps {
  roomCode?: string;
  currentUserId: string|null;
  currentUsername?: string;
  onExit?: () => void;
  onTriggerRules?: () => void;
}

export interface Card {
  id: string;
  suit: SuitType;
  value: number; // Ace=1, Two=2 ... Ten=10
  label: string; // 'A', '2' ... '10'
}

export interface AIPlayer {
  id: number;
  name: string;
  hand: Card[];
  capturePile: Card[];
}

export interface CasinoMetrics {
  points: number;
  cards: number;
  spades: number;
  hasBigCasino: boolean;
  hasLittleCasino: boolean;
  aces: number;
}

// Custom hook to cleanly manage temporary workspace actions
function useSelectionState<T>() {
  const [selectedItems, setSelectedItems] = useState<T[]>([]);

  const toggleSelection = (item: T, identityKey: keyof T) => {
    setSelectedItems((prev) => {
      const exists = prev.some(
        (existing) => existing[identityKey] === item[identityKey],
      );
      if (exists) {
        return prev.filter(
          (existing) => existing[identityKey] !== item[identityKey],
        );
      }
      return [...prev, item];
    });
  };

  const clearSelection = () => setSelectedItems([]);

  return { selectedItems, toggleSelection, clearSelection, setSelectedItems };
}

 // Initialize the 40-card South African "Khasino" stripped pack (Aces to 10s only)
const initializeStrippedDeck = (): Card[] => {
  const suits: SuitType[] = ["♠", "♥", "♦", "♣"];
  const deckInstance: Card[] = [];

  suits.forEach((suit) => {
    for (let value = 1; value <= 10; value++) {
      let label = value.toString();
      if (value === 1) label = "A";

      deckInstance.push({
        id: `${suit}-${value}`,
        suit,
        value,
        label,
      });
    }
  });
  return deckInstance;
};

// Standard linear shuffle
const shuffleDeck = (targetDeck: Card[]): Card[] => {
  const cloned = [...targetDeck];
  for (let i = cloned.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cloned[i], cloned[j]] = [cloned[j], cloned[i]];
  }
  return cloned;
};
export default function CasinoGame({
  roomCode, currentUserId,currentUsername, onExit, onTriggerRules
}: CasinoGameProps) {
  // ==========================================
  // 2. STATE DECLARATIONS
  // ==========================================

  // --- Live Synchronized Database States ---
  const [roomId, setRoomId] = useState<string | null>(null);
  const [roomData, setRoomData] = useState<any>(null);
  const [allPlayers, setAllPlayers] = useState<any[]>([]);
  const [myPlayerRowId, setMyPlayerRowId] = useState<string | null>(null);

  const [deck, setDeck] = useState<Card[]>([]);
  
  // 1. Fetch Room Data and Listen to Live Changes
  
const [activeRoomCode, setActiveRoomCode] = useState<string>(roomCode || "");
  const [joinInput, setJoinInput] = useState<string>("");

  // Create a brand new room in Supabase and sit in Seat 0
  const handleCreateRoom = async () => {
    const newCode = Math.random().toString(36).substring(2, 7).toUpperCase();

    const { data: newRoom, error } = await supabase
      .from("kasi_rooms")
      .insert([{ room_code: newCode, turn_index: 0, table_cards: [], status: "waiting" }])
      .select()
      .single();

    if (error || !newRoom) {
      alert("Could not create room: " + error?.message);
      return;
    }

    const { data: insertedPlayer, error: playerError } = await supabase.from("kasi_players").insert([
    {
      room_id: newRoom.id,
      profile_id: currentUserId,
      username: currentUsername || "Host",
      seat_index: 0,
      hand: [],
      capture_pile: [],
      sweeps:0, },
  ])
  .select()
  .single();

  if (playerError) {
    alert("Player Insert Failed: " + playerError.message);
    return;
  }
  if (insertedPlayer) {
    setMyPlayerRowId(insertedPlayer.id);
  }

    setActiveRoomCode(newCode);
  };

  // Join an existing room by code and take the next open seat
  const handleJoinRoom = async () => {
    const codeToJoin = joinInput.trim().toUpperCase();
    if (!codeToJoin) return;

    const { data: existingRoom } = await supabase
      .from("kasi_rooms")
      .select("*, kasi_players(*)")
      .eq("room_code", codeToJoin)
      .maybeSingle();

    if (!existingRoom) {
      alert("Room not found! Check the code.");
      return;
    }

    const currentPlayers = existingRoom.kasi_players || [];

    // 1. Check if this logged-in user is ALREADY seated in this room (e.g., after a page refresh)
    if (currentUserId) {
      const alreadySeated = currentPlayers.find((p: any) => p.profile_id === currentUserId);
      if (alreadySeated) {
        setMyPlayerRowId(alreadySeated.id);
        setActiveRoomCode(codeToJoin);
        return;
      }
    }

    // 2. Stop new players from joining if the table already has 4 people
    if (currentPlayers.length >= 4) {
      alert("This table is full (Max 4 players)!");
      return;
    }

    // 3. Otherwise, insert into the next open seat
    const nextSeat = currentPlayers.length;
    const { data: insertedPlayer, error: playerError } = await supabase
      .from("kasi_players")
      .insert([
        {
          room_id: existingRoom.id,
          profile_id: currentUserId,
          username: currentUsername || `Player ${nextSeat + 1}`,
          seat_index: nextSeat,
          hand: [],
          capture_pile: [],
          sweeps: 0,
        },
      ])
      .select()
      .single();

    if (playerError) {
      alert("Player Insert Failed: " + playerError.message);
      return;
    }

    if (insertedPlayer) {
      setMyPlayerRowId(insertedPlayer.id);
    }
    setActiveRoomCode(codeToJoin);
  };

  // 1. Fetch Room Data and Listen to Live Changes
  useEffect(() => {
    if (!activeRoomCode || activeRoomCode === "undefined") return;

    const initializeMultiplayer = async () => {
      const { data: room } = await supabase
        .from("kasi_rooms")
        .select("*, kasi_players(*)")
        .eq("room_code", activeRoomCode)
        .maybeSingle();

      if (room) {
        setRoomId(room.id);
        setRoomData(room);
        setAllPlayers(room.kasi_players || []);

        const roomSubscription = supabase
          .channel(`room-${activeRoomCode}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "kasi_rooms", filter: `id=eq.${room.id}` },
            async () => {
              const { data: updatedRoom } = await supabase
                .from("kasi_rooms")
                .select("*, kasi_players(*)")
                .eq("id", room.id)
                .single();
              if (updatedRoom) {
                setRoomData(updatedRoom);
                setAllPlayers(updatedRoom.kasi_players || []);
              }
            }
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "kasi_players", filter: `room_id=eq.${room.id}` },
            async () => {
              const { data: updatedRoom } = await supabase
                .from("kasi_rooms")
                .select("*, kasi_players(*)")
                .eq("id", room.id)
                .single();
              if (updatedRoom) {
                setRoomData(updatedRoom);
                setAllPlayers(updatedRoom.kasi_players || []);
              }
            }
          )
          .subscribe();

        return () => {
          supabase.removeChannel(roomSubscription);
        };
      }
    };

    initializeMultiplayer();
  }, [activeRoomCode]);


// 2. Identify who "You" are at this table
  const localPlayer = allPlayers.find(
    (p) => (myPlayerRowId && p.id === myPlayerRowId) || (currentUserId && p.profile_id === currentUserId)
  );
  const isMyTurn = roomData && localPlayer && roomData.turn_index === localPlayer.seat_index;

  // Use variables extracted cleanly from the live database structures
  const tableCards: Card[] = roomData?.table_cards || [];
  const playerHand: Card[] = localPlayer?.hand || [];

  // Game Setup Configurations
  const [opponentCount, setOpponentCount] = useState<1 | 2>(1); // 1 = Two-Player, 2 = Three-Player Match
  const [activeTurn, setActiveTurn] = useState<TurnEntity | null>(null);
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [totalRounds, setTotalRounds] = useState<number>(2);
  const [gameLog, setGameLog] = useState<string>(
    "",
  );

  // Interaction Workspaces
  const [selectedHandCard, setSelectedHandCard] = useState<Card | null>(null);
  const {
    selectedItems: selectedTableCards,
    toggleSelection: toggleTableSelection,
    clearSelection: clearTableSelection,
  } = useSelectionState<Card>();

  // Modals and UI flags

  //const [activeBuildValue, setActiveBuildValue] = useState<number | null>(null);
  const [sweepsCount, setSweepsCount] = useState<{
    player: number;
    ai1: number;
    ai2: number;
  }>({
    player: 0,
    ai1: 0,
    ai2: 0,
  });
  // Tracks if an AI's top pile card is currently selected for a combo/build move
  // Format: { aiId: number, card: Card }
  const [selectedPileTarget, setSelectedPileTarget] = useState<{
    aiId: number;
    card: Card;
  } | null>(null);

  // Active UI highlights
  const [isStealTargetHuman, setIsStealTargetHuman] = useState<boolean>(false);
  const [stealTargetAiId, setStealTargetAiId] = useState<number | null>(null);

  // Derived Match Status Evaluators
  const isPlayerHandEmpty = playerHand.length === 0;
  const isHandEmptyCycleReached = useMemo(() => {
  if (allPlayers.length === 0) return false;
  return allPlayers.every((player) => (player.hand?.length || 0) === 0);
}, [allPlayers]);

  // ==========================================
  // 3. ENGINE UTILITIES
  // ==========================================
  const advanceTurnSystem = () => {
    setActiveTurn((current) => {
      if (!current) return null;
      if (opponentCount === 1) {
        return current === "player" ? "ai1" : "player";
      } else {
        if (current === "player") return "ai1";
        if (current === "ai1") return "ai2";
        return "player";
      }
    });
  };

  const evaluatePile = (pile: Card[]): CasinoMetrics => {
    const cards = pile.length;
    const spades = pile.filter((c) => c.suit === "♠").length;
    const hasBigCasino = pile.some((c) => c.suit === "♦" && c.value === 10);
    const hasLittleCasino = pile.some((c) => c.suit === "♠" && c.value === 2);
    const aces = pile.filter((c) => c.value === 1).length;

    let points = 0;
    if (hasBigCasino) points += 2;
    if (hasLittleCasino) points += 1;
    points += aces;

    return { points, cards, spades, hasBigCasino, hasLittleCasino, aces };
  };
  // ==========================================
  // 4. GAME SYSTEM DEAL CONTROLLERS
  // ==========================================
  
  const handleDealGame = async () => {
    if (!roomId || allPlayers.length < 2 || allPlayers.length > 4) {
      alert("You need between 2 and 4 players connected to start!");
      return;
    }

    const freshDeck = shuffleDeck(initializeStrippedDeck());
    const sortedPlayers = [...allPlayers].sort((a, b) => a.seat_index - b.seat_index);
    const count = sortedPlayers.length;

    // 2 Players = 10 cards each (Round 1 of 2)
    // 3 Players = 13 cards each (1 card to floor)
    // 4 Players = 10 cards each (All 40 dealt at once)
    const cardsPerPlayer = count === 3 ? 13 : 10;
    let cardCursor = 0;

    for (const p of sortedPlayers) {
      const dealtHand = freshDeck.slice(cardCursor, cardCursor + cardsPerPlayer);
      cardCursor += cardsPerPlayer;

      await supabase
        .from("kasi_players")
        .update({ hand: dealtHand, capture_pile: [], sweeps: 0 })
        .eq("id", p.id);
    }

    const floorCards = count === 3 ? freshDeck.slice(39, 40) : [];
    const leftoverDeck = count === 2 ? freshDeck.slice(20) : [];
    const randomStarterSeat = Math.floor(Math.random() * count);

    await supabase
      .from("kasi_rooms")
      .update({
        table_cards: floorCards,
        deck: leftoverDeck,
        turn_index: randomStarterSeat,
        status: "playing",
        last_capturer_seat: null,
        game_log: `🎴 ${count}-Player Match Started! ${sortedPlayers[randomStarterSeat].username} goes first.`,
      })
      .eq("id", roomId);

    setSelectedHandCard(null);
    clearTableSelection();
  };

  const handleDealNextRound = async () => {
    const remainingDeck: Card[] = roomData?.deck || [];
    if (!roomId || remainingDeck.length < 20) return;

    const sortedPlayers = [...allPlayers].sort((a, b) => a.seat_index - b.seat_index);

    for (let i = 0; i < sortedPlayers.length; i++) {
      const nextHand = remainingDeck.slice(i * 10, (i + 1) * 10);
      await supabase
        .from("kasi_players")
        .update({ hand: nextHand })
        .eq("id", sortedPlayers[i].id);
    }

    await supabase
      .from("kasi_rooms")
      .update({
        deck: [],
        turn_index: 0,
        status: "playing",
        game_log: "🔄 Round 2 Dealt! Final 10 cards distributed to both players.",
      })
      .eq("id", roomId);

    setSelectedHandCard(null);
    clearTableSelection();
  };

  // ==========================================
  // 5. HUMAN PLAYER MOVE CONTROLLERS
  // ==========================================

  //update your hand/pile, update the table floor, 
  // and pass the turn to the next seat.

  const syncMoveToDatabase = async (
  newTableCards: Card[],
  newPlayerHand: Card[],
  newCapturePile: Card[],
  newLogMessage: string,
  madeCapture: boolean = false,
  earnedSweep: boolean = false
) => {
  if (!roomData || !localPlayer || !roomId) return;

  const nextTurnIndex = (roomData.turn_index + 1) % allPlayers.length;
  const currentSweeps = localPlayer.sweeps || 0;

  // 1. Update your player row (hand, pile, and sweeps)
  await supabase
    .from("kasi_players")
    .update({
      hand: newPlayerHand,
      capture_pile: newCapturePile,
      sweeps: earnedSweep ? currentSweeps + 1 : currentSweeps,
    })
    .eq("id", localPlayer.id);

  // 2. Update the room row (table cards, turn index, game log, last capturer)
  const roomUpdates: any = {
    table_cards: newTableCards,
    turn_index: nextTurnIndex,
    game_log: newLogMessage,
  };

  if (madeCapture) {
    roomUpdates.last_capturer_seat = localPlayer.seat_index;
  }

  await supabase
    .from("kasi_rooms")
    .update(roomUpdates)
    .eq("id", roomId);

  // 3. Clear your local click selections
  setSelectedHandCard(null);
  clearTableSelection();
};

  // Action A: Trail a card face up onto the table floor
  const handleTrailCard = async (card: Card) => {
  if (!isMyTurn || !localPlayer) return;

  const updatedTable = [...tableCards, card];
  const updatedHand = playerHand.filter((c) => c.id !== card.id);
  const log = `💨 ${localPlayer.username || "Player"} trailed a ${card.label}${card.suit}.`;

  await syncMoveToDatabase(updatedTable, updatedHand, localPlayer.capture_pile || [], log, false, false);
};

  // Action B: Capture a single identical matching card from the floor
  const handleSingleMatch = async (handCard: Card, floorCard: Card) => {
  if (!isMyTurn || !localPlayer) return;
  if (handCard.value !== floorCard.value) return;

  const updatedTable = tableCards.filter((c) => c.id !== floorCard.id);
  const updatedHand = playerHand.filter((c) => c.id !== handCard.id);
  const updatedPile = [...(localPlayer.capture_pile || []), handCard, floorCard];

  // Check for Sweep (cleared the table, and it's not the very last card of the match)
  const isSweep = updatedTable.length === 0;
  const allOtherHandsEmpty = allPlayers.every((p) => p.id === localPlayer.id || (p.hand?.length || 0) === 0);
  const isLastCard = updatedHand.length === 0 && allOtherHandsEmpty && (roomData.deck?.length || 0) === 0;
  const earnedSweep = isSweep && !isLastCard;

  const log = earnedSweep
    ? `💥 SWEEP! ${localPlayer.username} matched ${handCard.label}${handCard.suit} for +1 point!`
    : `🎯 ${localPlayer.username} matched ${handCard.label}${handCard.suit} with ${floorCard.label}${floorCard.suit}.`;

  await syncMoveToDatabase(updatedTable, updatedHand, updatedPile, log, true, earnedSweep);
};

  // Action C: Execute an aggressive Pile Theft from an opponent
  const handleExecuteTheft = async (handCard: Card, targetPlayerId: string) => {
  if (!isMyTurn || !localPlayer) return;

  const targetPlayer = allPlayers.find((p) => p.id === targetPlayerId);
  if (!targetPlayer || targetPlayer.capture_pile.length === 0) return;

  const topOpponentCard = targetPlayer.capture_pile[targetPlayer.capture_pile.length - 1];

  if (handCard.value !== topOpponentCard.value) {
    setGameLog("❌ Invalid Theft: Your card value doesn't match their top pile card.");
    return;
  }

  // 1. Compile the newly stolen stash
  const stolenBatch = [...targetPlayer.capture_pile];
  const updatedMyCapturePile = [...(localPlayer.capture_pile || []), handCard, ...stolenBatch];
  const updatedMyHand = playerHand.filter((c) => c.id !== handCard.id);

  // 2. Calculate the next turn order around the table
  const nextTurnIndex = (roomData.turn_index + 1) % allPlayers.length;

  // 3. Atomically update the database (or use an RPC function)
  // Clear target's pile
  await supabase
    .from("kasi_players")
    .update({ capture_pile: [] })
    .eq("id", targetPlayerId);

  // Give everything to the local player
  await supabase
    .from("kasi_players")
    .update({ hand: updatedMyHand, capture_pile: updatedMyCapturePile })
    .eq("id", localPlayer.id);

  // Advance the room state turn index
  await supabase
    .from("kasi_rooms")
    .update({ 
      turn_index: nextTurnIndex,
      last_capturer_seat: localPlayer.seat_index,
      game_log: `⚔ MMO CASINO THEFT! ${localPlayer.username} stole ${targetPlayer.username}'s entire pile!`,
    })
    .eq("id", roomId);

  setGameLog(`⚔ MMO CASINO THEFT! You stole ${targetPlayer.username}'s entire pile!`);
  setSelectedHandCard(null);
};
  // Action D: Capture multiple table cards that add up to your played card value
  const handleComboCapture = async (handCard: Card, selectedFloor: Card[]) => {
  if (!isMyTurn || !localPlayer) return;

  const totalFloorSum = selectedFloor.reduce((sum, c) => sum + c.value, 0);
  if (totalFloorSum % handCard.value !== 0 || totalFloorSum === 0) {
    setGameLog(`❌ Invalid Combo Selection.`);
    return;
  }

  const floorIds = selectedFloor.map((c) => c.id);
  const updatedTable = tableCards.filter((c) => !floorIds.includes(c.id));
  const updatedHand = playerHand.filter((c) => c.id !== handCard.id);
  const updatedPile = [...(localPlayer.capture_pile || []), handCard, ...selectedFloor];

  const isSweep = updatedTable.length === 0;
  const allOtherHandsEmpty = allPlayers.every((p) => p.id === localPlayer.id || (p.hand?.length || 0) === 0);
  const isLastCard = updatedHand.length === 0 && allOtherHandsEmpty && (roomData.deck?.length || 0) === 0;
  const earnedSweep = isSweep && !isLastCard;

  const log = earnedSweep
    ? `💥 MULTI-SWEEP! ${localPlayer.username} cleared the floor for +1 point!`
    : `🤖 ${localPlayer.username} scooped a combo using ${handCard.label}${handCard.suit}!`;

  await syncMoveToDatabase(updatedTable, updatedHand, updatedPile, log, true, earnedSweep);
};

  // Action E: Build a numerical compound value on the table floor
  const handleCreateBuild = async (handCard: Card, selectedFloor: Card[], buildValue: number) => {
  if (!isMyTurn || !localPlayer) return;

  const floorSum = selectedFloor.reduce((sum, c) => sum + c.value, 0);
  if (handCard.value + floorSum !== buildValue) {
    setGameLog(`❌ Invalid Build Value Configuration.`);
    return;
  }

  const hasBackup = playerHand.some((c) => c.id !== handCard.id && c.value === buildValue);
  if (!hasBackup) {
    setGameLog(`❌ Invalid Build: You must hold a ${buildValue} in hand to back up this build.`);
    return;
  }

  const complexBuildItem: Card = {
    id: `build-${Date.now()}`,
    suit: handCard.suit,
    value: buildValue,
    label: `BUILD (${buildValue})`,
  };

  const floorIds = selectedFloor.map((c) => c.id);
  const updatedTable = [...tableCards.filter((c) => !floorIds.includes(c.id)), complexBuildItem];
  const updatedHand = playerHand.filter((c) => c.id !== handCard.id);
  const log = `🏗️ ${localPlayer.username} set a Level ${buildValue} Build on the floor!`;

  await syncMoveToDatabase(updatedTable, updatedHand, localPlayer.capture_pile || [], log, false, false);
};
  const handleAddToExistingBuild = (
    handCard: Card,
    selectedFloor: Card[],
    targetBuildToken: Card,
  ) => {
    if (!isMyTurn) return;

    // Calculate the mathematical value of the extra cards being added
    const extraFloorSum = selectedFloor.reduce((sum, c) => sum + c.value, 0);
    const addedValue = handCard.value + extraFloorSum;

    // The new additions must equal the exact same level value of the target build
    if (addedValue !== targetBuildToken.value) {
      setGameLog(
        `❌ Invalid Addition: Trying to add ${addedValue} points, but this build is locked at Level ${targetBuildToken.value}.`,
      );
      return;
    }

    // Verify the player still holds a final capture card for this build level
    const hasBackup = playerHand.some(
      (c) => c.id !== handCard.id && c.value === targetBuildToken.value,
    );
    if (!hasBackup) {
      setGameLog(
        `❌ Invalid Operation: You must hold a ${targetBuildToken.value} in your hand to maintain this build.`,
      );
      return;
    }

    const floorIds = selectedFloor.map((c) => c.id);

    // Keep the target build token on the floor, but consume the new cards played from the field
    setTableCards((prev) => prev.filter((c) => !floorIds.includes(c.id)));
    setPlayerHand((prev) => prev.filter((c) => c.id !== handCard.id));

    setGameLog(
      `🏗️ Build Accumulated! You added a ${handCard.label} and floor cards to reinforce the Level ${targetBuildToken.value} Build!`,
    );

    // Clear selection state workspaces
    setSelectedHandCard(null);
    clearTableSelection();
    advanceTurnSystem();
  };
  //stealing from your opponents building
  // Move 1: Play hand card + floor card(s) to BUILD ONTO an opponent's top pile card
  const handleBuildOntoPile = async (
    handCard: Card,
    selectedFloor: Card[],
    targetPlayerId: string,
    targetPileCard: Card,
  ) => {
    if (!isMyTurn || !localPlayer || !roomId) return;

    const floorSum = selectedFloor.reduce((sum, c) => sum + c.value, 0);
    const compoundValue = handCard.value + floorSum;

    if (compoundValue !== targetPileCard.value) {
      setGameLog(
        `❌ Invalid: Hand + floor sum (${compoundValue}) must match pile card (${targetPileCard.value}).`,
      );
      return;
    }

    const hasBackup = playerHand.some(
      (c) => c.id !== handCard.id && c.value === compoundValue,
    );
    if (!hasBackup) {
      setGameLog(
        `❌ Invalid: You need a backup ${compoundValue} in hand to secure this build.`,
      );
      return;
    }

    const targetPlayer = allPlayers.find((p) => p.id === targetPlayerId);
    if (!targetPlayer) return;

    const newBuildToken: Card = {
      id: `pile-build-${Date.now()}`,
      suit: handCard.suit,
      value: compoundValue,
      label: `BUILD (${compoundValue})`,
    };

    const floorIds = selectedFloor.map((c) => c.id);
    const updatedTable = [
      ...tableCards.filter((c) => !floorIds.includes(c.id)),
      newBuildToken,
    ];
    const updatedHand = playerHand.filter((c) => c.id !== handCard.id);
    const updatedTargetPile = (targetPlayer.capture_pile || []).slice(0, -1);
    const log = `🏗️ Pile Lockdown! ${localPlayer.username} built onto ${targetPlayer.username}'s ${targetPileCard.label}!`;

    // 1. Peel top card off opponent's pile in Supabase
    await supabase
      .from("kasi_players")
      .update({ capture_pile: updatedTargetPile })
      .eq("id", targetPlayerId);

    // 2. Sync your hand, the new floor build, and advance turn
    await syncMoveToDatabase(
      updatedTable,
      updatedHand,
      localPlayer.capture_pile || [],
      log,
      false,
      false,
    );

    setSelectedPileTarget(null);
  };

  // Move 2: Play hand card + steal opponent's top card to BUILD USING it on a floor card
  const handleBuildUsingPile = async (
    handCard: Card,
    selectedFloor: Card[],
    targetPlayerId: string,
    targetPileCard: Card,
  ) => {
    if (!isMyTurn || !localPlayer || !roomId) return;

    if (selectedFloor.length !== 1) {
      setGameLog(
        "❌ Select exactly one floor card to build onto using a pile card.",
      );
      return;
    }

    const floorCard = selectedFloor[0];
    const compoundValue = handCard.value + targetPileCard.value;

    if (compoundValue !== floorCard.value) {
      setGameLog(
        `❌ Invalid: Hand + pile card (${compoundValue}) must equal the floor card (${floorCard.value}).`,
      );
      return;
    }

    const hasBackup = playerHand.some(
      (c) => c.id !== handCard.id && c.value === compoundValue,
    );
    if (!hasBackup) {
      setGameLog(
        `❌ Invalid: You must hold a ${compoundValue} in hand to back up this build.`,
      );
      return;
    }

    const targetPlayer = allPlayers.find((p) => p.id === targetPlayerId);
    if (!targetPlayer) return;

    const newBuildToken: Card = {
      id: `use-build-${Date.now()}`,
      suit: handCard.suit,
      value: compoundValue,
      label: `BUILD (${compoundValue})`,
    };

    const updatedTable = tableCards.map((c) =>
      c.id === floorCard.id ? newBuildToken : c,
    );
    const updatedHand = playerHand.filter((c) => c.id !== handCard.id);
    const updatedTargetPile = (targetPlayer.capture_pile || []).slice(0, -1);
    const log = `⚔ Hand Hijack! ${localPlayer.username} snatched ${targetPlayer.username}'s ${targetPileCard.label} to build ${floorCard.label}!`;

    // 1. Peel top card off opponent's pile in Supabase
    await supabase
      .from("kasi_players")
      .update({ capture_pile: updatedTargetPile })
      .eq("id", targetPlayerId);

    // 2. Sync your hand, the updated floor build, and advance turn
    await syncMoveToDatabase(
      updatedTable,
      updatedHand,
      localPlayer.capture_pile || [],
      log,
      false,
      false,
    );

    setSelectedPileTarget(null);
  };

   // ==========================================
  // 6. TRADITIONAL MMO SCORING EVALUATOR CYCLE
  // ==========================================
  useEffect(() => {
    // Only run when all hands are empty, game is active, and YOU are the Host (Seat 0)
    const isHost = localPlayer?.seat_index === 0;
    const isGameActive = roomData?.status === "playing" || roomData?.turn_index !== null;
    
    if (!isHandEmptyCycleReached || !roomData || !isHost || !isGameActive) return;

    const processEndOfCycle = async () => {
      const remainingDeck: Card[] = roomData.deck || [];

      // 1. If there are still cards in the deck (Round 1 of a 2-player game), pause for Round 2
      if (remainingDeck.length > 0) {
        await supabase
          .from("kasi_rooms")
          .update({
            game_log: "🎴 Hands empty! Round 1 complete. Host: click 'Deal Round 2' to hand out remaining cards.",
            status: "round_pause",
          })
          .eq("id", roomId);
        return;
      }

      // 2. Otherwise, the match is completely over! Scoop remaining floor cards to last capturer
      let bonusLogMessage = "";
      const updatedPlayers = allPlayers.map((p) => {
        let pile: Card[] = [...(p.capture_pile || [])];
        if (tableCards.length > 0 && p.seat_index === roomData.last_capturer_seat) {
          pile = [...pile, ...tableCards];
          bonusLogMessage = ` 🎁 Last Trick Bonus: ${p.username} swept up the remaining ${tableCards.length} table cards!`;
        }
        return { ...p, finalPile: pile };
      });

      // 3. Calculate base points, card counts, and spades for every player
      const evaluated = updatedPlayers.map((p) => {
        const metrics = evaluatePile(p.finalPile);
        const sweeps = p.sweeps || 0;
        return {
          ...p,
          metrics,
          totalPoints: metrics.points + sweeps,
        };
      });

      // 4. Award Majority Bonuses (+2 Most Cards, +1 Most Spades)
      const maxCards = Math.max(...evaluated.map((p) => p.metrics.cards));
      const maxSpades = Math.max(...evaluated.map((p) => p.metrics.spades));

      evaluated.forEach((p) => {
        if (p.metrics.cards === maxCards && maxCards > 0) p.totalPoints += 2;
        if (p.metrics.spades === maxSpades && maxSpades > 0) p.totalPoints += 1;
      });

      // 5. Build the final scoreboard and crown the winner
      const sortedByScore = [...evaluated].sort((a, b) => b.totalPoints - a.totalPoints);
      const winner = sortedByScore[0];
      const scoreboard = evaluated
        .map((p) => `${p.username}: ${p.totalPoints} Pts (${p.metrics.cards} cards)`)
        .join(" | ");

      const finalAnnouncement = `🏆 Match Concluded! ${winner.username} WON!${bonusLogMessage} Final -> ${scoreboard}`;

      // 6. Save updated piles and finish the room in Supabase
      for (const p of evaluated) {
        await supabase
          .from("kasi_players")
          .update({ capture_pile: p.finalPile })
          .eq("id", p.id);
      }

      await supabase
        .from("kasi_rooms")
        .update({
          table_cards: [],
          turn_index: null,
          status: "finished",
          game_log: finalAnnouncement,
        })
        .eq("id", roomId);
    };

    processEndOfCycle();
  }, [isHandEmptyCycleReached, roomData, allPlayers, localPlayer, tableCards, roomId]);
  // ==========================================
  // 7. OMNI-DIRECTIONAL AI AUTOMATION ENGINE
  /* ==========================================
  useEffect(() => {
    if (!activeTurn || isMyTurn) return;

    const currentAiId = activeTurn === "ai1" ? 1 : 2;
    const activeAi = aiOpponents.find((ai) => ai.id === currentAiId);

    if (!activeAi || activeAi.hand.length === 0) {
      advanceTurnSystem();
      return;
    }

    const thinkingTimer = setTimeout(() => {
      let chosenCard = activeAi.hand[0];
      let stolenFromTarget: "player" | number | null = null;
      let targetCapturedCards: Card[] = [];

      // ------ PHASE A: OMNIDIRECTIONAL PILE THEFT CHECK ------

      // 1. Check for outright single-card pile hijacking (Highest Priority)
      if ((localPlayer?.capture_pile || []).length > 0) {
        const topHumanCard = (localPlayer?.capture_pile || [])[(localPlayer?.capture_pile || []).length - 1];
        const matchInHand = activeAi.hand.find(
          (c) => c.value === topHumanCard.value,
        );
        if (matchInHand) {
          chosenCard = matchInHand;
          stolenFromTarget = "player";
          targetCapturedCards = [matchInHand, ...(localPlayer?.capture_pile || [])];
        }
      }

      // 2. Scan Rival AI Piles if human wasn't targeted (Crucial for 3-Player mode)
      if (stolenFromTarget === null && opponentCount === 2) {
        const targetAiOpponentId = currentAiId === 1 ? 2 : 1;
        const targetAiData = aiOpponents.find(
          (a) => a.id === targetAiOpponentId,
        );
        if (targetAiData && targetAiData.capturePile.length > 0) {
          const topAiCard =
            targetAiData.capturePile[targetAiData.capturePile.length - 1];
          const matchInHand = activeAi.hand.find(
            (c) => c.value === topAiCard.value,
          );
          if (matchInHand) {
            chosenCard = matchInHand;
            stolenFromTarget = targetAiOpponentId;
            targetCapturedCards = [matchInHand, ...targetAiData.capturePile];
          }
        }
      }

      // Execute Theft Action if matched
      if (stolenFromTarget !== null) {
        if (stolenFromTarget === "player") set(localPlayer?.capture_pile || [])([]);
        else
          setAiOpponents((p) =>
            p.map((a) =>
              a.id === stolenFromTarget ? { ...a, capturePile: [] } : a,
            ),
          );

        setAiOpponents((p) =>
          p.map((a) =>
            a.id === currentAiId
              ? {
                  ...a,
                  hand: a.hand.filter((c) => c.id !== chosenCard.id),
                  capturePile: [...a.capturePile, ...targetCapturedCards],
                }
              : a,
          ),
        );

        const victimName =
          stolenFromTarget === "player"
            ? "YOUR"
            : `AI Opponent #${stolenFromTarget}'s`;
        setGameLog(
          `⚔️ PILE STEAL! ${activeAi.name} played a ${chosenCard.label} to hijack ${victimName} entire stack!`,
        );
        advanceTurnSystem();
        return;
      }
      // 2. NOW LINKED & LIVE: Advanced Cross-Theft Pile Building (Second Priority)
      const crossBuildMove = findAiCrossTheftBuild(
        activeAi.hand,
        tableCards,
        aiOpponents,
        currentAiId,
      );
      if (crossBuildMove) {
        const { type, handCard, floorCards, target, pileCard } = crossBuildMove;
        const targetName = target === "player" ? "YOUR" : `AI #${target}'s`;
        const buildValue =
          type === "onto" ? pileCard.value : floorCards[0].value;

        // Peel the top card off the targeted opponent's home capture pile
        if (target === "player") set(localPlayer?.capture_pile || [])((p) => p.slice(0, -1));
        else
          setAiOpponents((p) =>
            p.map((a) =>
              a.id === target
                ? { ...a, capturePile: a.capturePile.slice(0, -1) }
                : a,
            ),
          );

        // Generate the complex tabletop composite token
        const newBuildToken: Card = {
          id: `ai-build-${Date.now()}`,
          suit: handCard.suit,
          value: buildValue,
          label: `BUILD (${buildValue})`,
        };

        const floorIds = floorCards.map((c) => c.id);

        if (type === "onto") {
          // Compound everything onto the floor
          setTableCards((p) => [
            ...p.filter((c) => !floorIds.includes(c.id)),
            newBuildToken,
          ]);
        } else {
          // Replace single floor card with the build block
          setTableCards((p) =>
            p.map((c) => (c.id === floorIds[0] ? newBuildToken : c)),
          );
        }

        // Remove the card from the AI's hand
        setAiOpponents((p) =>
          p.map((a) =>
            a.id === currentAiId
              ? {
                  ...a,
                  hand: a.hand.filter((c) => c.id !== handCard.id),
                }
              : a,
          ),
        );

        setGameLog(
          `🏗️ AI Strategy! ${activeAi.name} targeted ${targetName} pile to set up a level ${buildValue} Build on the floor!`,
        );
        advanceTurnSystem();
        return;
      }

      // ------ PHASE B: STANDARD FLOOR MATH COMBOS ------
      let calculatedComboCaptures: Card[] = [];
      for (let i = 0; i < activeAi.hand.length; i++) {
        const possibleCaptures = findAllSimultaneousCombinations(
          activeAi.hand[i].value,
          tableCards,
        );
        if (possibleCaptures.length > 0) {
          chosenCard = activeAi.hand[i];
          calculatedComboCaptures = possibleCaptures;
          break;
        }
      }

      if (calculatedComboCaptures.length > 0) {
        targetCapturedCards = [chosenCard, ...calculatedComboCaptures];
        const capturedIds = calculatedComboCaptures.map((c) => c.id);
        // Log this specific AI as the last successful capturer
        setLastCapturer(activeTurn);
        const isSweep = tableCards.length === calculatedComboCaptures.length;
        //the last person to take the remainign card
        const isLastCardOfGame =
          activeAi.hand.length === 1 &&
          playerHand.length === 0 &&
          aiOpponents.every((ai) =>
            ai.id === currentAiId ? true : ai.hand.length === 0,
          ) &&
          (opponentCount === 1 ? currentRound === 2 : true);

        setTableCards((prev) =>
          prev.filter((c) => !capturedIds.includes(c.id)),
        );
        setAiOpponents((prev) =>
          prev.map((ai) =>
            ai.id === currentAiId
              ? {
                  ...ai,
                  hand: ai.hand.filter((c) => c.id !== chosenCard.id),
                  capturePile: [...ai.capturePile, ...targetCapturedCards],
                }
              : ai,
          ),
        );

        if (isSweep && !isLastCardOfGame) {
          setSweepsCount((prev) => ({
            ...prev,
            [currentAiId === 1 ? "ai1" : "ai2"]:
              prev[currentAiId === 1 ? "ai1" : "ai2"] + 1,
          }));
          setGameLog(
            `💥 AI SWEEP! ${activeAi.name} cleared the floor with a ${chosenCard.label}!`,
          );
        } else {
          setGameLog(
            `🤖 ${activeAi.name} captured a layout combination using a ${chosenCard.label}!`,
          );
        }
        advanceTurnSystem();
        return;
      }

      // ------ PHASE C: DRIFT ESCAPE HAND CARD ------
      setTableCards((prev) => [...prev, chosenCard]);
      setAiOpponents((prev) =>
        prev.map((ai) =>
          ai.id === currentAiId
            ? {
                ...ai,
                hand: ai.hand.filter((c) => c.id !== chosenCard.id),
              }
            : ai,
        ),
      );

      setGameLog(
        `💨 Drift: ${activeAi.name} laid down a ${chosenCard.label}${chosenCard.suit}.`,
      );
      advanceTurnSystem();
    }, 1200);

    return () => clearTimeout(thinkingTimer);
  }, [activeTurn, aiOpponents, tableCards, (localPlayer?.capture_pile || []), opponentCount]);*/
  // ==========================================
  // 8. INTERACTIVE RENDER ENGINE (JSX)
  // ==========================================

if (!activeRoomCode) {
    return (
      <div
        style={{
          maxWidth: "480px",
          margin: "60px auto",
          padding: "24px",
          backgroundColor: "#1F2937",
          color: "#F9FAFB",
          borderRadius: "12px",
          textAlign: "center",
          fontFamily: "sans-serif",
        }}
      >
        <h2 style={{ color: "#FBBF24", marginBottom: "8px" }}>
          SA eKasi Casino Lobby
        </h2>
        <p style={{ color: "#9CA3AF", marginBottom: "24px", fontSize: "14px" }}>
          Create a table and share the code with a friend (or open a second tab to test).
        </p>

        <button
          onClick={handleCreateRoom}
          style={{
            width: "100%",
            padding: "12px",
            backgroundColor: "#059669",
            color: "#FFF",
            border: "none",
            borderRadius: "8px",
            fontWeight: "bold",
            fontSize: "16px",
            cursor: "pointer",
            marginBottom: "20px",
          }}
        >
          ➕ Create New Table
        </button>

        <div style={{ display: "flex", gap: "8px" }}>
          <input
            value={joinInput}
            onChange={(e) => setJoinInput(e.target.value)}
            placeholder="Enter 5-letter Room Code"
            style={{
              flex: 1,
              padding: "10px",
              borderRadius: "6px",
              border: "1px solid #4B5563",
              backgroundColor: "#111827",
              color: "#FFF",
              textTransform: "uppercase",
            }}
          />
          <button
            onClick={handleJoinRoom}
            style={{
              padding: "10px 20px",
              backgroundColor: "#2563EB",
              color: "#FFF",
              border: "none",
              borderRadius: "6px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "16px",
        fontFamily: "sans-serif",
        backgroundColor: "#111827",
        color: "#F9FAFB",
        minHeight: "100vh",
      }}
    >
      {/* HEADER CONTROLS */}
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: "16px",
          borderBottom: "2px solid #374151",
          gap: "12px",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "28px",
              fontWeight: "bold",
              margin: 0,
              color: "#FBBF24",
            }}
          >
            SA eKasi Casino Game
          </h1>
          <p style={{ margin: "4px 0 0", color: "#9CA3AF" }}>
            Room Code: <strong style={{ color: "#FBBF24" }}>{activeRoomCode}</strong> | Players Connected: {allPlayers.length}
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          {localPlayer?.seat_index === 0 && (
            <button
              onClick={handleDealGame}
              style={{
                padding: "10px 16px",
                backgroundColor: "#059669",
                color: "#FFF",
                border: "none",
                borderRadius: "6px",
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              🎴 Deal Match ({allPlayers.length} Players)
            </button>
          )}

          {localPlayer?.seat_index === 0 &&
            (roomData?.deck?.length || 0) > 0 &&
            isHandEmptyCycleReached && (
              <button
                onClick={handleDealNextRound}
                style={{
                  padding: "10px 16px",
                  backgroundColor: "#DC2626",
                  color: "#FFF",
                  border: "none",
                  borderRadius: "6px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                🔄 Deal Round 2
              </button>
            )}
        </div>
      </header>

      {/* GAME STATUS LOG DISPLAY */}
      <div
        style={{
          margin: "16px 0",
          padding: "12px",
          backgroundColor: "#1F2937",
          borderRadius: "8px",
          borderLeft: "4px solid #FBBF24",
          fontSize: "15px",
        }}
      >
        <strong>System Notice:</strong> {roomData?.game_log || gameLog}
      </div>
      {/* OPPONENTS & INTERACTIVE OUTFIELD ZONE */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: opponentCount === 1 ? "1fr" : "1fr 1fr",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        {allPlayers
          .filter((p) => p.id !== localPlayer?.id)
          .map((opponent) => {
            const opponentPile: Card[] = opponent.capture_pile || [];
            const opponentHand: Card[] = opponent.hand || [];
            const metrics = evaluatePile(opponentPile);
            const hasCardsInPile = opponentPile.length > 0;
            const topCard = hasCardsInPile
              ? opponentPile[opponentPile.length - 1]
              : null;

            const isOpponentTurn = roomData?.turn_index === opponent.seat_index;
            const isPileCardSelected =
              selectedPileTarget !== null &&
              selectedPileTarget.aiId === opponent.id;

            const isStealable =
              selectedHandCard !== null &&
              topCard !== null &&
              selectedHandCard.value === topCard.value &&
              selectedTableCards.length === 0 &&
              selectedPileTarget === null &&
              isMyTurn;

            const floorSum = selectedTableCards.reduce((s, c) => s + c.value, 0);
            const handVal = selectedHandCard ? selectedHandCard.value : 0;

            const canBuildOnto =
              selectedHandCard !== null &&
              topCard !== null &&
              handVal + floorSum === topCard.value &&
              selectedPileTarget?.aiId === opponent.id;

            const canBuildUsing =
              selectedHandCard !== null &&
              topCard !== null &&
              selectedTableCards.length === 1 &&
              handVal + topCard.value === selectedTableCards[0].value &&
              selectedPileTarget?.aiId === opponent.id;

            return (
              <div
                key={opponent.id}
                style={{
                  backgroundColor: "#1F2937",
                  padding: "16px",
                  borderRadius: "8px",
                  border: isOpponentTurn
                    ? "2px solid #FBBF24"
                    : "2px solid transparent",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <h3 style={{ margin: 0, fontSize: "18px", color: "#FBBF24" }}>
                    {opponent.username || `Player (Seat ${opponent.seat_index})`}
                  </h3>
                  <span
                    style={{
                      fontSize: "13px",
                      backgroundColor: "#374151",
                      padding: "4px 8px",
                      borderRadius: "4px",
                    }}
                  >
                    🃏 Hand: {opponentHand.length} cards
                  </span>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    marginTop: "12px",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#9CA3AF",
                        marginBottom: "4px",
                      }}
                    >
                      Pile ({opponentPile.length} cards)
                    </div>
                    {topCard ? (
                      <div
                        onClick={() => {
                          if (!isMyTurn) return;
                          if (isPileCardSelected) {
                            setSelectedPileTarget(null);
                          } else {
                            setSelectedPileTarget({
                              aiId: opponent.id,
                              card: topCard,
                            });
                          }
                        }}
                        style={{
                          width: "60px",
                          height: "84px",
                          backgroundColor: isPileCardSelected
                            ? "#FEE2E2"
                            : "#FFF",
                          color: ["♥", "♦"].includes(topCard.suit)
                            ? "#DC2626"
                            : "#000",
                          borderRadius: "6px",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          padding: "6px",
                          boxSizing: "border-box",
                          fontWeight: "bold",
                          cursor: isMyTurn ? "pointer" : "default",
                          border: isPileCardSelected
                            ? "4px solid #DC2626"
                            : isStealable
                              ? "4px dashed #FBBF24"
                              : "1px solid #CCC",
                          transform:
                            isStealable || isPileCardSelected
                              ? "scale(1.05)"
                              : "none",
                          transition: "all 0.2s",
                        }}
                      >
                        <div style={{ fontSize: "14px", lineHeight: 1 }}>
                          {topCard.label}
                        </div>
                        <div
                          style={{
                            fontSize: "24px",
                            textAlign: "center",
                            lineHeight: 1,
                          }}
                        >
                          {topCard.suit}
                        </div>
                      </div>
                    ) : (
                      <div
                        style={{
                          width: "60px",
                          height: "84px",
                          border: "2px dashed #4B5563",
                          borderRadius: "6px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#4B5563",
                          fontSize: "12px",
                        }}
                      >
                        Empty
                      </div>
                    )}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", color: "#D1D5DB" }}>
                      ⚡ Pts: {metrics.points} | Spades: {metrics.spades}
                    </div>
                    {isStealable && (
                      <button
                        onClick={() =>
                          handleExecuteTheft(selectedHandCard!, opponent.id)
                        }
                        style={{
                          marginTop: "12px",
                          width: "100%",
                          padding: "8px",
                          backgroundColor: "#DC2626",
                          color: "#FFF",
                          border: "none",
                          borderRadius: "4px",
                          fontWeight: "bold",
                          cursor: "pointer",
                        }}
                      >
                        ⚔️ STEAL PILE
                      </button>
                    )}

                    {canBuildOnto && (
                      <button
                        onClick={() =>
                          handleBuildOntoPile(
                            selectedHandCard!,
                            selectedTableCards,
                            opponent.id,
                            topCard!,
                          )
                        }
                        style={{
                          marginTop: "12px",
                          width: "100%",
                          padding: "8px",
                          backgroundColor: "#7C3AED",
                          color: "#FFF",
                          border: "none",
                          borderRadius: "4px",
                          fontWeight: "bold",
                          cursor: "pointer",
                        }}
                      >
                        🏗️ BUILD ONTO PILE
                      </button>
                    )}

                    {canBuildUsing && (
                      <button
                        onClick={() =>
                          handleBuildUsingPile(
                            selectedHandCard!,
                            selectedTableCards,
                            opponent.id,
                            topCard!,
                          )
                        }
                        style={{
                          marginTop: "12px",
                          width: "100%",
                          padding: "8px",
                          backgroundColor: "#2563EB",
                          color: "#FFF",
                          border: "none",
                          borderRadius: "4px",
                          fontWeight: "bold",
                          cursor: "pointer",
                        }}
                      >
                        🧮 BUILD USING PILE
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
      </div>

      {/* THE TABLE FLOOR FIELD */}
      <div
        style={{
          backgroundColor: "#064E3B",
          padding: "20px",
          borderRadius: "12px",
          marginBottom: "24px",
          border: "4px solid #047857",
        }}
      >
        <h3
          style={{
            margin: "0 0 12px 0",
            fontSize: "16px",
            textTransform: "uppercase",
            color: "#A7F3D0",
            letterSpacing: "1px",
          }}
        >
          Table Floor Layout
        </h3>
        {tableCards.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "24px",
              color: "#A7F3D0",
              fontStyle: "italic",
            }}
          >
            Floor is empty. Trail a card.
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
            {tableCards.map((card) => {
              const isSelected = selectedTableCards.some(
                (c) => c.id === card.id,
              );
              return (
                <div
                  key={card.id}
                  onClick={() =>
                    isMyTurn && toggleTableSelection(card, "id")
                  }
                  style={{
                    width: "70px",
                    height: "98px",
                    backgroundColor: isSelected ? "#FEF3C7" : "#FFF",
                    color: ["♥", "♦"].includes(card.suit) ? "#DC2626" : "#000",
                    borderRadius: "6px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    padding: "8px",
                    boxSizing: "border-box",
                    fontWeight: "bold",
                    cursor: isMyTurn ? "pointer" : "default",
                    border: isSelected ? "4px solid #D97706" : "1px solid #CCC",
                    transform: isSelected ? "translateY(-6px)" : "none",
                    boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
                    transition: "all 0.1s",
                  }}
                >
                  <div style={{ fontSize: "14px", lineHeight: 1 }}>
                    {card.label}
                  </div>
                  <div
                    style={{
                      fontSize: "28px",
                      textAlign: "center",
                      lineHeight: 1,
                    }}
                  >
                    {card.suit}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* PLAYER WORKSPACE INTERFACE */}
      <div
        style={{
          backgroundColor: "#1F2937",
          padding: "20px",
          borderRadius: "12px",
          border:
            isMyTurn ? "2px solid #3B82F6" : "1px solid #374151",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "16px",
            gap: "12px",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "18px", color: "#3B82F6" }}>
              👤 Your Hand ({playerHand.length} cards)
            </h3>
            {/* USEFUL FLAG: Display a helpful out-of-cards message when hand is empty */}
            {isPlayerHandEmpty ? (
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: "13px",
                  color: "#EF4444",
                  fontWeight: "bold",
                }}
              >
                ⚠️ You have no cards left! Waiting for this round's turn cycle
                to finish.
              </p>
            ) : (
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: "13px",
                  color: "#9CA3AF",
                }}
              >
                Your Stack: {(localPlayer?.capture_pile || []).length} cards | Spades:{" "}
                {(localPlayer?.capture_pile || []).filter((c) => c.suit === "♠").length}
              </p>
            )}
          </div>

          {/* COMBINATIONS AND ACTION HOT-BAR */}
          {selectedHandCard && isMyTurn && (
            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                backgroundColor: "#111827",
                padding: "8px",
                borderRadius: "8px",
              }}
            >
              <button
                onClick={() => handleTrailCard(selectedHandCard)}
                style={{
                  padding: "8px 12px",
                  backgroundColor: "#4B5563",
                  color: "#FFF",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "bold",
                }}
              >
                💨 Trail ({selectedHandCard.label})
              </button>

              {selectedTableCards.length === 1 &&
                selectedHandCard.value === selectedTableCards[0].value && (
                  <button
                    onClick={() =>
                      handleSingleMatch(selectedHandCard, selectedTableCards[0])
                    }
                    style={{
                      padding: "8px 12px",
                      backgroundColor: "#2563EB",
                      color: "#FFF",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: "bold",
                    }}
                  >
                    🎯 Match Pair
                  </button>
                )}

              {selectedTableCards.length > 1 && (
                <button
                  onClick={() =>
                    handleComboCapture(selectedHandCard, selectedTableCards)
                  }
                  style={{
                    padding: "8px 12px",
                    backgroundColor: "#059669",
                    color: "#FFF",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "bold",
                  }}
                >
                  🧮 Capture Math Combo
                </button>
              )}
              {selectedTableCards.length > 0 &&
                (() => {
                  // Find if exactly one of the selected table items is an active Build token
                  const buildTokens = selectedTableCards.filter((c) =>
                    c.label.includes("BUILD"),
                  );
                  const regularFloorCards = selectedTableCards.filter(
                    (c) => !c.label.includes("BUILD"),
                  );

                  if (buildTokens.length === 1) {
                    const targetBuild = buildTokens[0];
                    return (
                      <button
                        onClick={() =>
                          handleAddToExistingBuild(
                            selectedHandCard,
                            regularFloorCards,
                            targetBuild,
                          )
                        }
                        style={{
                          padding: "8px 12px",
                          backgroundColor: "#10B981",
                          color: "#FFF",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: "bold",
                        }}
                      >
                        ➕ Add to Level {targetBuild.value} Build
                      </button>
                    );
                  }
                  return null;
                })()}

              {selectedTableCards.length > 0 && (
                <button
                  onClick={() => {
                    const floorSum = selectedTableCards.reduce(
                      (s, c) => s + c.value,
                      0,
                    );
                    const targetVal = selectedHandCard.value + floorSum;
                    const hasBackup = playerHand.some(
                      (c) =>
                        c.id !== selectedHandCard.id && c.value === targetVal,
                    );
                    if (hasBackup) {
                      handleCreateBuild(
                        selectedHandCard,
                        selectedTableCards,
                        targetVal,
                      );
                    } else {
                      alert(
                        `Hold a backup ${targetVal} card to execute this build request.`,
                      );
                    }
                  }}
                  style={{
                    padding: "8px 12px",
                    backgroundColor: "#7C3AED",
                    color: "#FFF",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "bold",
                  }}
                >
                  🏗️ Request Build
                </button>
              )}
            </div>
          )}
        </div>

        {/* HUMAN PLAYABLE CARDS GRID */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
          {playerHand.map((card) => {
            const isSelected = selectedHandCard?.id === card.id;
            return (
              <div
                key={card.id}
                onClick={() =>
                  isMyTurn &&
                  setSelectedHandCard(isSelected ? null : card)
                }
                style={{
                  width: "75px",
                  height: "105px",
                  backgroundColor: isSelected ? "#DBEAFE" : "#FFF",
                  color: ["♥", "♦"].includes(card.suit) ? "#DC2626" : "#000",
                  borderRadius: "6px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  padding: "10px",
                  boxSizing: "border-box",
                  fontWeight: "bold",
                  cursor: isMyTurn ? "pointer" : "default",
                  border: isSelected ? "4px solid #3B82F6" : "1px solid #CCC",
                  transform: isSelected ? "translateY(-10px)" : "none",
                  boxShadow: isSelected
                    ? "0 10px 15px -3px rgba(59,130,246,0.5)"
                    : "0 4px 6px rgba(0,0,0,0.1)",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: "15px", lineHeight: 1 }}>
                  {card.label}
                </div>
                <div
                  style={{
                    fontSize: "32px",
                    textAlign: "center",
                    lineHeight: 1,
                  }}
                >
                  {card.suit}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
