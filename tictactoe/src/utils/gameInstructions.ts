export interface GameInstruction {
  title: string;
  objective: string;
  rules: string[];
  tips: string[];
}

export const GAME_INSTRUCTIONS: Record<string, GameInstruction> = {
    casino: {
    title: "build, steal and manupulate numbers",
    objective: "Collect all the point to win",
    rules: [
      "The goal of the game is to use cards in your hand to 'build' and capture cards from the table layout by matching their values or adding them up.Drifting: If you play a card from your hand without capturing anything, it is called 'drifting'.The Pile Steal: When you capture cards, you keep your capture pile face up. If the top card of your opponent's pile matches a card in your hand (or helps form a math build), you can steal their cards!"
    ],
    tips: [
      "Keep an eye on your timer color state—it flashes dangerous red indicators when falling under 3 seconds.",
      "Focus purely on accuracy first; building an intuitive pattern rhythm allows you to bypass complex processing."
    ]
  }
};