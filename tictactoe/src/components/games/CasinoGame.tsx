import { useState, useEffect, useMemo } from "react";

// ==========================================
// 1. TYPES & DATA STRUCTS
// ==========================================
export type SuitType = "♠" | "♥" | "♦" | "♣";
export type TurnEntity = "player" | "ai1" | "ai2";

interface CasinoGameProps {
  onExit: () => void;
  onTriggerRules: () => void;
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
  onExit,
  onTriggerRules,
}: CasinoGameProps) {
  // ==========================================
  // 2. STATE DECLARATIONS
  // ==========================================
  const [deck, setDeck] = useState<Card[]>([]);
  const [playerHand, setPlayerHand] = useState<Card[]>([]);
  const [aiOpponents, setAiOpponents] = useState<AIPlayer[]>([]);
  const [tableCards, setTableCards] = useState<Card[]>([]);
  const [playerCapturePile, setPlayerCapturePile] = useState<Card[]>([]);

  // Game Setup Configurations
  const [opponentCount, setOpponentCount] = useState<1 | 2>(1); // 1 = Two-Player, 2 = Three-Player Match
  const [activeTurn, setActiveTurn] = useState<TurnEntity | null>(null);
  const [currentRound, setCurrentRound] = useState<number>(1);
  const [totalRounds, setTotalRounds] = useState<number>(2);
  const [gameLog, setGameLog] = useState<string>(
    "🇿🇦 Welcome to eKasi Casino! Pick your match mode below to shuffle.",
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
    const humanEmpty = playerHand.length === 0;
    const aiEmpty = aiOpponents.every((ai) => ai.hand.length === 0);
    return humanEmpty && aiEmpty;
  }, [playerHand, aiOpponents]);

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
  const handleDealGame = (selectedPlayersCount: 1 | 2) => {
    setOpponentCount(selectedPlayersCount);
    let freshDeck = shuffleDeck(initializeStrippedDeck());

    // Reset core metrics
    setPlayerCapturePile([]);
    setCurrentRound(1);
    setSelectedHandCard(null);
    clearTableSelection();
    setSweepsCount({ player: 0, ai1: 0, ai2: 0 });
    setLastCapturer(null);

    if (selectedPlayersCount === 1) {
      // 2 Players: 10 cards each per round (2 Rounds total = 40 cards)
      setTotalRounds(2);
      setPlayerHand(freshDeck.slice(0, 10));

      const generatedAI: AIPlayer[] = [
        {
          id: 1,
          name: "🤖 AI Opponent",
          hand: freshDeck.slice(10, 20),
          capturePile: [],
        },
      ];
      setAiOpponents(generatedAI);
      setTableCards([]); // Base game setup starts with an empty floor structure
      setDeck(freshDeck.slice(20)); // Remaining 20 cards reserved for round 2

      const turnSelector: TurnEntity = Math.random() < 0.5 ? "player" : "ai1";
      setActiveTurn(turnSelector);
      setGameLog(
        `🎴 2-Player Match Initiated. 10 cards dealt to each player. Round 1 of 2.`,
      );
    } else {
      // 3 Players: 13 cards each (39 cards total), remaining 1 card drops to the floor
      setTotalRounds(1);
      setPlayerHand(freshDeck.slice(0, 13));

      const generatedAI: AIPlayer[] = [
        {
          id: 1,
          name: "🤖 AI Opponent #1",
          hand: freshDeck.slice(13, 26),
          capturePile: [],
        },
        {
          id: 2,
          name: "🤖 AI Opponent #2",
          hand: freshDeck.slice(26, 39),
          capturePile: [],
        },
      ];
      setAiOpponents(generatedAI);
      setTableCards(freshDeck.slice(39, 40)); // 1 leftover card dropped to table floor
      setDeck([]); // Deck is entirely emptied

      const choices: TurnEntity[] = ["player", "ai1", "ai2"];
      const randomStarter = choices[Math.floor(Math.random() * 3)];
      setActiveTurn(randomStarter);
      setGameLog(
        `🎴 3-Player Match Initiated. 13 cards dealt to each player, 1 card left on floor.`,
      );
    }
  };

  const handleDealNextRound = () => {
    if (deck.length === 0) return;

    // Hand out the final 20 cards (10 to player, 10 to AI)
    const nextPlayerHand = deck.slice(0, 10);
    const nextAiHand = deck.slice(10, 20);

    setPlayerHand(nextPlayerHand);
    setAiOpponents((prev) =>
      prev.map((ai) => (ai.id === 1 ? { ...ai, hand: nextAiHand } : ai)),
    );
    setDeck([]);
    setCurrentRound(2);

    // Reset round states
    setSelectedHandCard(null);
    clearTableSelection();

    setActiveTurn("player");
    setGameLog(`🔄 Round 2 Dealt! Final 10 cards distributed to both players.`);
  };

  // Tracks who made the last successful capture ('player', 'ai1', or 'ai2')
  const [lastCapturer, setLastCapturer] = useState<TurnEntity | null>(null);

  // Helper utility for recursive math combination checking
  const findAllSimultaneousCombinations = (
    targetValue: number,
    pool: Card[],
  ): Card[] => {
    let unallocatedPool = [...pool];
    let totalCapturedCards: Card[] = [];

    // Continuous deep-search loop
    while (unallocatedPool.length > 0) {
      const searchForSingleGroup = (
        index: number,
        currentSum: number,
        currentGroup: Card[],
      ): Card[] | null => {
        if (currentSum === targetValue && currentGroup.length > 0)
          return currentGroup;
        if (currentSum > targetValue || index >= unallocatedPool.length)
          return null;

        // Route A: Include card
        const withItem = searchForSingleGroup(
          index + 1,
          currentSum + unallocatedPool[index].value,
          [...currentGroup, unallocatedPool[index]],
        );
        if (withItem) return withItem;

        // Route B: Skip card
        return searchForSingleGroup(index + 1, currentSum, currentGroup);
      };

      const foundGroup = searchForSingleGroup(0, 0, []);
      if (foundGroup && foundGroup.length > 0) {
        // Log group, pull them out of the pool, and loop to look for more combos
        totalCapturedCards = [...totalCapturedCards, ...foundGroup];
        const groupIds = foundGroup.map((c) => c.id);
        unallocatedPool = unallocatedPool.filter(
          (c) => !groupIds.includes(c.id),
        );
      } else {
        // No further independent combinations exist for this target value
        break;
      }
    }

    return totalCapturedCards;
  };

  //AI can steal from a home pile
  const findAiCrossTheftBuild = (
    aiHand: Card[],
    floor: Card[],
    allAis: AIPlayer[],
    currentAiId: number,
  ) => {
    // 1. Gather all valid opponent piles to target
    const targets: { owner: "player" | number; topCard: Card }[] = [];
    if (playerCapturePile.length > 0) {
      targets.push({
        owner: "player",
        topCard: playerCapturePile[playerCapturePile.length - 1],
      });
    }
    allAis.forEach((ai) => {
      if (ai.id !== currentAiId && ai.capturePile.length > 0) {
        targets.push({
          owner: ai.id,
          topCard: ai.capturePile[ai.capturePile.length - 1],
        });
      }
    });

    // 2. Scan for matching move combinations
    for (const card of aiHand) {
      // Ensure the AI holds a backup duplicate card in its hand to secure the build level
      const holdsBackup = (targetVal: number) =>
        aiHand.some((c) => c.id !== card.id && c.value === targetVal);

      for (const t of targets) {
        // Strategy A: Build ONTO their pile card (Hand Card + Floor Cards == Pile Card)
        const partialFloorMatch = findAllSimultaneousCombinations(
          t.topCard.value - card.value,
          floor,
        );
        if (partialFloorMatch.length > 0 && holdsBackup(t.topCard.value)) {
          return {
            type: "onto" as const,
            handCard: card,
            floorCards: partialFloorMatch,
            target: t.owner,
            pileCard: t.topCard,
          };
        }

        // Strategy B: Build USING their pile card (Hand Card + Pile Card == Single Floor Card)
        for (const fCard of floor) {
          if (
            card.value + t.topCard.value === fCard.value &&
            holdsBackup(fCard.value)
          ) {
            return {
              type: "using" as const,
              handCard: card,
              floorCards: [fCard],
              target: t.owner,
              pileCard: t.topCard,
            };
          }
        }
      }
    }
    return null;
  };

  // ==========================================
  // 5. HUMAN PLAYER MOVE CONTROLLERS
  // ==========================================

  // Action A: Trail a card face up onto the table floor
  const handleTrailCard = (card: Card) => {
    if (activeTurn !== "player") return;

    setTableCards((prev) => [...prev, card]);
    setPlayerHand((prev) => prev.filter((c) => c.id !== card.id));
    setSelectedHandCard(null);
    clearTableSelection();

    setGameLog(
      `💨 You trailed a ${card.label}${card.suit} onto the table floor.`,
    );
    advanceTurnSystem();
  };

  // Action B: Capture a single identical matching card from the floor
  const handleSingleMatch = (handCard: Card, floorCard: Card) => {
    if (activeTurn !== "player") return;
    if (handCard.value !== floorCard.value) return;

    const capturedBatch = [handCard, floorCard];
    setTableCards((prev) => prev.filter((c) => c.id !== floorCard.id));
    setPlayerHand((prev) => prev.filter((c) => c.id !== handCard.id));
    setPlayerCapturePile((prev) => [...prev, ...capturedBatch]);

    // Log player as the last successful capturer
    setLastCapturer("player");

    // Check if this cleared the floor, and ENSURE it wasn't your last card
    const isSweep = tableCards.length === 1;
    const isLastCardOfGame =
      playerHand.length === 1 &&
      aiOpponents.every((ai) => ai.hand.length === 0) &&
      (opponentCount === 1 ? currentRound === 2 : true);

    if (isSweep && !isLastCardOfGame) {
      setSweepsCount((prev) => ({ ...prev, player: prev.player + 1 }));
      setGameLog(
        `💥 SWEEP! You matched a ${handCard.label}${handCard.suit} for +1 point!`,
      );
    } else {
      setGameLog(
        `🎯 You matched your ${handCard.label}${handCard.suit} with a ${floorCard.label}${floorCard.suit}.`,
      );
    }

    setSelectedHandCard(null);
    clearTableSelection();
    advanceTurnSystem();
  };

  // Action C: Execute an aggressive Pile Theft from an opponent
  const handleExecuteTheft = (handCard: Card, target: "player" | number) => {
    if (activeTurn !== "player") return;

    let stolenBatch: Card[] = [];
    let opponentName = "";

    if (target === "player") return; // Cannot steal from yourself

    // Access target AI and pull their pile
    const targetAi = aiOpponents.find((ai) => ai.id === target);
    if (!targetAi || targetAi.capturePile.length === 0) return;

    const topOpponentCard =
      targetAi.capturePile[targetAi.capturePile.length - 1];
    if (handCard.value !== topOpponentCard.value) {
      setGameLog(
        `❌ Invalid Theft: Your ${handCard.label} does not match their top card (${topOpponentCard.label}).`,
      );
      return;
    }

    // Extract pile and clear target
    stolenBatch = [...targetAi.capturePile];
    opponentName = targetAi.name;

    setAiOpponents((prev) =>
      prev.map((ai) => (ai.id === target ? { ...ai, capturePile: [] } : ai)),
    );

    // Combine player card with entire stolen pile
    setPlayerCapturePile((prev) => [...prev, handCard, ...stolenBatch]);
    setPlayerHand((prev) => prev.filter((c) => c.id !== handCard.id));

    setGameLog(
      `⚔️ CASINO THEFT! You used a ${handCard.label}${handCard.suit} to steal ${opponentName}'s entire pile!`,
    );

    setSelectedHandCard(null);
    clearTableSelection();
    setIsStealTargetHuman(false);
    setStealTargetAiId(null);
    advanceTurnSystem();
  };
  // Action D: Capture multiple table cards that add up to your played card value
  const handleComboCapture = (handCard: Card, selectedFloor: Card[]) => {
    if (activeTurn !== "player") return;

    const totalFloorSum = selectedFloor.reduce((sum, c) => sum + c.value, 0);
    if (totalFloorSum % handCard.value !== 0 || totalFloorSum === 0) {
      setGameLog(`❌ Invalid Combo Selection.`);
      return;
    }

    const calculatedSubGroups = totalFloorSum / handCard.value;
    const capturedBatch = [handCard, ...selectedFloor];
    const floorIds = selectedFloor.map((c) => c.id);

    setTableCards((prev) => prev.filter((c) => !floorIds.includes(c.id)));
    setPlayerHand((prev) => prev.filter((c) => c.id !== handCard.id));
    setPlayerCapturePile((prev) => [...prev, ...capturedBatch]);

    // Log player as the last successful capturer
    setLastCapturer("player");

    // Sweep validation
    const isSweep = tableCards.length === selectedFloor.length;
    const isLastCardOfGame =
      playerHand.length === 1 &&
      aiOpponents.every((ai) => ai.hand.length === 0) &&
      (opponentCount === 1 ? currentRound === 2 : true);

    if (isSweep && !isLastCardOfGame) {
      setSweepsCount((prev) => ({ ...prev, player: prev.player + 1 }));
      setGameLog(`💥 MULTI-SWEEP! Floor cleared for +1 point!`);
    } else {
      setGameLog(
        `🧮 Multi-Fish Scooped! Caught ${calculatedSubGroups} separate combinations.`,
      );
    }

    setSelectedHandCard(null);
    clearTableSelection();
    advanceTurnSystem();
  };

  // Action E: Build a numerical compound value on the table floor
  const handleCreateBuild = (
    handCard: Card,
    selectedFloor: Card[],
    buildValue: number,
  ) => {
    if (activeTurn !== "player") return;

    const floorSum = selectedFloor.reduce((sum, c) => sum + c.value, 0);
    if (handCard.value + floorSum !== buildValue) {
      setGameLog(`❌ Invalid Build Value Configuration.`);
      return;
    }

    const hasMatchingCardInHand = playerHand.some(
      (c) => c.id !== handCard.id && c.value === buildValue,
    );
    if (!hasMatchingCardInHand) {
      setGameLog(
        `❌ Invalid Build: You must hold a ${buildValue} in hand to back up this build.`,
      );
      return;
    }

    // Merge hand card and floor selections into a single tabletop compound element

    const complexBuildItem: Card = {
      id: `build-${Date.now()}`,
      suit: handCard.suit,
      value: buildValue,
      label: `BUILD (${buildValue})`,
    };

    const floorIds = selectedFloor.map((c) => c.id);
    setTableCards((prev) => [
      ...prev.filter((c) => !floorIds.includes(c.id)),
      complexBuildItem,
    ]);
    setPlayerHand((prev) => prev.filter((c) => c.id !== handCard.id));

    setGameLog(
      `🏗️ Build Set! Created a tactical level ${buildValue} compound on the floor.`,
    );
    setSelectedHandCard(null);
    clearTableSelection();
    //setActiveActionModal("none");
    //setActiveBuildValue(null);
    advanceTurnSystem();
  };
  const handleAddToExistingBuild = (
    handCard: Card,
    selectedFloor: Card[],
    targetBuildToken: Card,
  ) => {
    if (activeTurn !== "player") return;

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
  const handleBuildOntoPile = (
    handCard: Card,
    selectedFloor: Card[],
    targetAiId: number,
    targetPileCard: Card,
  ) => {
    if (activeTurn !== "player") return;

    const floorSum = selectedFloor.reduce((sum, c) => sum + c.value, 0);
    const compoundValue = handCard.value + floorSum;

    // The combination must mathematically equal the opponent's top card to build onto it
    if (compoundValue !== targetPileCard.value) {
      setGameLog(
        `❌ Invalid: Hand + floor sum (${compoundValue}) must match pile card (${targetPileCard.value}).`,
      );
      return;
    }

    // Verify player holds the ultimate capture card for this build level
    const hasBackup = playerHand.some(
      (c) => c.id !== handCard.id && c.value === compoundValue,
    );
    if (!hasBackup) {
      setGameLog(
        `❌ Invalid: You need a backup ${compoundValue} in hand to secure this build.`,
      );
      return;
    }

    const floorIds = selectedFloor.map((c) => c.id);
    const targetAi = aiOpponents.find((a) => a.id === targetAiId);
    if (!targetAi) return;

    // Create the build token
    const newBuildToken: Card = {
      id: `pile-build-${Date.now()}`,
      suit: handCard.suit,
      value: compoundValue,
      label: `BUILD (${compoundValue})`,
    };

    // Remove the top card from the AI's capture pile
    setAiOpponents((prev) =>
      prev.map((ai) => {
        if (ai.id === targetAiId) {
          return { ...ai, capturePile: ai.capturePile.slice(0, -1) };
        }
        return ai;
      }),
    );

    // Place the floor cards, hand card, and the stolen top card into a compound build on the floor
    setTableCards((prev) => [
      ...prev.filter((c) => !floorIds.includes(c.id)),
      newBuildToken,
    ]);
    setPlayerHand((prev) => prev.filter((c) => c.id !== handCard.id));

    setGameLog(
      `🏗️ Pile Lockdown! You combined your ${handCard.label} with the floor to build right ONTO ${targetAi.name}'s ${targetPileCard.label}!`,
    );

    // Reset workspace
    setSelectedHandCard(null);
    clearTableSelection();
    setSelectedPileTarget(null);
    advanceTurnSystem();
  };

  // Move 2: Play hand card + steal opponent's top card to BUILD USING it on a floor card
  const handleBuildUsingPile = (
    handCard: Card,
    selectedFloor: Card[],
    targetAiId: number,
    targetPileCard: Card,
  ) => {
    if (activeTurn !== "player") return;

    if (selectedFloor.length !== 1) {
      setGameLog(
        "❌ Select exactly one floor card to build onto using a pile card.",
      );
      return;
    }

    const floorCard = selectedFloor[0];
    const compoundValue = handCard.value + targetPileCard.value;

    // The hand card + stolen pile card must equal the targeted floor card value
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

    const targetAi = aiOpponents.find((a) => a.id === targetAiId);
    if (!targetAi) return;

    const newBuildToken: Card = {
      id: `use-build-${Date.now()}`,
      suit: handCard.suit,
      value: compoundValue,
      label: `BUILD (${compoundValue})`,
    };

    // Peel the top card off the opponent's pile
    setAiOpponents((prev) =>
      prev.map((ai) => {
        if (ai.id === targetAiId) {
          return { ...ai, capturePile: ai.capturePile.slice(0, -1) };
        }
        return ai;
      }),
    );

    // Transform the targeted floor card into the compound build token
    setTableCards((prev) =>
      prev.map((c) => (c.id === floorCard.id ? newBuildToken : c)),
    );
    setPlayerHand((prev) => prev.filter((c) => c.id !== handCard.id));

    setGameLog(
      `⚔️ Hand Hijack! You snatched ${targetAi.name}'s ${targetPileCard.label}, matched it with your ${handCard.label}, and built onto the floor's ${floorCard.label}!`,
    );

    setSelectedHandCard(null);
    clearTableSelection();
    setSelectedPileTarget(null);
    advanceTurnSystem();
  };

  // ==========================================
  // 6. TRADITIONAL SCORING EVALUATOR CYCLE
  // ==========================================
  useEffect(() => {
    if (isHandEmptyCycleReached && activeTurn !== null) {
      // If playing 2-player mode and it's only the end of Round 1, pause for the next deal
      if (opponentCount === 1 && currentRound === 1) {
        setGameLog(
          "🎴 Hands empty! Round 1 complete. Click 'Deal Round 2' to hand out remaining cards.",
        );
        return;
      }

      // EXECUTE THE LAST TRICK SCOOP RULES
      let finalPlayerPile = [...playerCapturePile];
      let updatedAiOpponents = [...aiOpponents];
      let bonusLogMessage = "";

      if (tableCards.length > 0) {
        if (lastCapturer === "player") {
          finalPlayerPile = [...finalPlayerPile, ...tableCards];
          bonusLogMessage = ` 🎁 Last Trick Bonus: You made the last capture, sweeping up the remaining ${tableCards.length} table cards!`;
        } else if (lastCapturer === "ai1" || lastCapturer === "ai2") {
          const winnerId = lastCapturer === "ai1" ? 1 : 2;
          updatedAiOpponents = aiOpponents.map((ai) => {
            if (ai.id === winnerId) {
              return { ...ai, capturePile: [...ai.capturePile, ...tableCards] };
            }
            return ai;
          });
          const aiName = winnerId === 1 ? "AI Opponent #1" : "AI Opponent #2";
          bonusLogMessage = ` 🎁 Last Trick Bonus: ${aiName} made the last capture, scooping up the remaining ${tableCards.length} table cards!`;
        }
        // Force the table layout to empty since leftovers are harvested
        setTableCards([]);
      }

      // Parse traditional point metrics using our updated piles
      const playerM = evaluatePile(finalPlayerPile);
      const ai1M = evaluatePile(
        updatedAiOpponents.find((a) => a.id === 1)?.capturePile || [],
      );
      const ai2M = evaluatePile(
        updatedAiOpponents.find((a) => a.id === 2)?.capturePile || [],
      );

      let playerFinal = playerM.points + sweepsCount.player;
      let ai1Final = ai1M.points + sweepsCount.ai1;
      let ai2Final = ai2M.points + sweepsCount.ai2;

      // 1. Most Cards Majority Bonus (+2 Points)
      const maxCards = Math.max(
        playerM.cards,
        ai1M.cards,
        opponentCount === 2 ? ai2M.cards : 0,
      );
      if (playerM.cards === maxCards) playerFinal += 2;
      if (ai1M.cards === maxCards) ai1Final += 2;
      if (opponentCount === 2 && ai2M.cards === maxCards) ai2Final += 2;

      // 2. Most Spades Majority Bonus (+1 Point)
      const maxSpades = Math.max(
        playerM.spades,
        ai1M.spades,
        opponentCount === 2 ? ai2M.spades : 0,
      );
      if (playerM.spades === maxSpades) playerFinal += 1;
      if (ai1M.spades === maxSpades) ai1Final += 1;
      if (opponentCount === 2 && ai2M.spades === maxSpades) ai2Final += 1;

      let scoreboard = `You: ${playerFinal} Pts (${playerM.cards} cards, ${sweepsCount.player} sweeps) | AI1: ${ai1Final} Pts`;
      if (opponentCount === 2) scoreboard += ` | AI2: ${ai2Final} Pts`;

      let winnerAnnouncement = "🏆 Round Concluded!";
      if (
        playerFinal > ai1Final &&
        (opponentCount === 1 || playerFinal > ai2Final)
      ) {
        winnerAnnouncement += " YOU WON THIS MATCH!";
      } else {
        winnerAnnouncement += " THE AI TOOK THIS ROUND.";
      }

      setGameLog(
        `${winnerAnnouncement}${bonusLogMessage} Final Summary -> ${scoreboard}`,
      );
      setActiveTurn(null);
    }
  }, [isHandEmptyCycleReached, lastCapturer]);
  // ==========================================
  // 7. OMNI-DIRECTIONAL AI AUTOMATION ENGINE
  // ==========================================
  useEffect(() => {
    if (!activeTurn || activeTurn === "player") return;

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
      if (playerCapturePile.length > 0) {
        const topHumanCard = playerCapturePile[playerCapturePile.length - 1];
        const matchInHand = activeAi.hand.find(
          (c) => c.value === topHumanCard.value,
        );
        if (matchInHand) {
          chosenCard = matchInHand;
          stolenFromTarget = "player";
          targetCapturedCards = [matchInHand, ...playerCapturePile];
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
        if (stolenFromTarget === "player") setPlayerCapturePile([]);
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
        if (target === "player") setPlayerCapturePile((p) => p.slice(0, -1));
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
  }, [activeTurn, aiOpponents, tableCards, playerCapturePile, opponentCount]);
  // ==========================================
  // 8. INTERACTIVE RENDER ENGINE (JSX)
  // ==========================================
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
            🇿🇦 eKasi Casino Game
          </h1>
          <p
            style={{
              margin: "4px 0 0",
              color: "#9CA3AF",
            }}
          >
            Round {currentRound} of {totalRounds} | 40-Card Stripped Deck
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => handleDealGame(1)}
            style={{
              padding: "10px 16px",
              backgroundColor: "#2563EB",
              color: "#FFF",
              border: "none",
              borderRadius: "6px",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            👥 Play 2-Player (10 Cards)
          </button>

          <button
            onClick={() => handleDealGame(2)}
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
            👪 Play 3-Player (13 Cards)
          </button>

          {opponentCount === 1 &&
            deck.length > 0 &&
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
        <strong>System Notice:</strong> {gameLog}
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
        {aiOpponents.map((ai) => {
          const metrics = evaluatePile(ai.capturePile);
          const hasCardsInPile = ai.capturePile.length > 0;
          const topCard = hasCardsInPile
            ? ai.capturePile[ai.capturePile.length - 1]
            : null;

          const isPileCardSelected =
            selectedPileTarget !== null && selectedPileTarget.aiId === ai.id;

          const isStealable =
            selectedHandCard !== null &&
            topCard !== null &&
            selectedHandCard.value === topCard.value &&
            selectedTableCards.length === 0 &&
            selectedPileTarget === null &&
            activeTurn === "player";

          const floorSum = selectedTableCards.reduce((s, c) => s + c.value, 0);
          const handVal = selectedHandCard ? selectedHandCard.value : 0;

          const canBuildOnto =
            selectedHandCard !== null &&
            topCard !== null &&
            handVal + floorSum === topCard.value &&
            selectedPileTarget?.aiId === ai.id;

          const canBuildUsing =
            selectedHandCard !== null &&
            topCard !== null &&
            selectedTableCards.length === 1 &&
            // FIX: Access index 0 of the array to get the card value
            handVal + topCard.value === selectedTableCards[0].value &&
            selectedPileTarget?.aiId === ai.id;

          return (
            <div
              key={ai.id}
              style={{
                backgroundColor: "#1F2937",
                padding: "16px",
                borderRadius: "8px",
                border:
                  activeTurn === `ai${ai.id}`
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
                  {ai.name}
                </h3>
                <span
                  style={{
                    fontSize: "13px",
                    backgroundColor: "#374151",
                    padding: "4px 8px",
                    borderRadius: "4px",
                  }}
                >
                  🃏 Hand: {ai.hand.length} cards
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
                    Pile ({ai.capturePile.length} cards)
                  </div>
                  {topCard ? (
                    <div
                      onClick={() => {
                        if (activeTurn !== "player") return;
                        if (isPileCardSelected) {
                          setSelectedPileTarget(null);
                        } else {
                          setSelectedPileTarget({ aiId: ai.id, card: topCard });
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
                        cursor: activeTurn === "player" ? "pointer" : "default",
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
                        handleExecuteTheft(selectedHandCard!, ai.id)
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
                          ai.id,
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
                          ai.id,
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
                    activeTurn === "player" && toggleTableSelection(card, "id")
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
                    cursor: activeTurn === "player" ? "pointer" : "default",
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
            activeTurn === "player" ? "2px solid #3B82F6" : "1px solid #374151",
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
                Your Stack: {playerCapturePile.length} cards | Spades:{" "}
                {playerCapturePile.filter((c) => c.suit === "♠").length}
              </p>
            )}
          </div>

          {/* COMBINATIONS AND ACTION HOT-BAR */}
          {selectedHandCard && activeTurn === "player" && (
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
                  activeTurn === "player" &&
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
                  cursor: activeTurn === "player" ? "pointer" : "default",
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
