import { useRef, useState } from "react";
import { brand } from "../brand";
import { NeuroHero } from "./NeuroHero";
import { NeuralScene } from "./NeuralScene";
import { ProductPreview } from "./site/ProductPreview";

export function HeroStage({ stage }: { stage: 0 | 1 | 2 }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const visual = brand.heroVisual as string;
  const showVideo = videoReady && visual !== "classic";

  return (
    <div className="lp-hero-stage">
      {/* Probe only via real playable media — never HEAD-swap to a black video */}
      <video
        ref={videoRef}
        src={brand.heroVideo}
        className={showVideo ? "lp-hero-video" : "lp-hero-probe"}
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
      {showVideo ? null : visual === "classic" ? (
        <div className="hero-classic-fill">
          <NeuralScene />
        </div>
      ) : visual === "neuro" ? (
        <div className="hero-media">
          <NeuroHero />
        </div>
      ) : (
        <ProductPreview stage={stage} />
      )}
    </div>
  );
}
