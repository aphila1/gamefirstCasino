import { GAMES_LIST } from "../gameConfig";
import GameCard from "./GameCard";
import LivePlayerCounter from "./LivePlayerCounter"; // 🌟 Import the database tracker
import "./GameHub.css";
import AudioPlayer from "../components/AudioPlayer";

interface GameHubProps {
  onSelectGame: (gameId: string) => void;
}

export default function GameHub({ onSelectGame }: GameHubProps) {
  return (
    <div className="hub-container">
      {/* Studio Showcase Hero Banner */}
      <header className="hub-hero">
        <p className="studio-tagline">
          Play games, learn and do business all in one website. Check out
          SERVICES to help you get to the next level
        </p>

        {/* Dynamic Database Statistics Panel Layer */}
        <div className="studio-stats-bar">
          <LivePlayerCounter />
        </div>
        <AudioPlayer />
      </header>

      {/* Game Selection Grid Layout */}
      <main className="games-showcase">
        <h2>Game Catalogue</h2>
        <div className="games-grid">
          {GAMES_LIST.map((game) => (
            <GameCard key={game.id} game={game} onLaunch={onSelectGame} />
          ))}
        </div>
      </main>
    </div>
  );
}
