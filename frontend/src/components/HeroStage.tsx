import { useRef, useState } from "react";
import { brand } from "../brand";
import { NeuroHero } from "./NeuroHero";
import { NeuralScene } from "./NeuralScene";

export function HeroStage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);

  const showClassic = (brand.heroVisual as string) === "classic";
  const showVideo = videoReady && !showClassic;

  return (
    <div className="hero-media hero-stage" aria-label="Neurology coverage preview">
      {/* Probe only via real playable media — never HEAD-swap to a black video */}
      <video
        ref={videoRef}
        src={brand.heroVideo}
        className={showVideo ? "hero-video-on" : "hero-video-probe"}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => {
          const el = videoRef.current;
          if (el && el.readyState >= 2 && el.videoWidth > 0) {
            setVideoReady(true);
            void el.play().catch(() => setVideoReady(false));
          }
        }}
        onError={() => setVideoReady(false)}
      />

      {showVideo ? null : showClassic ? (
        <div className="hero-classic-fill">
          <NeuralScene />
        </div>
      ) : (
        <NeuroHero />
      )}
    </div>
  );
}
